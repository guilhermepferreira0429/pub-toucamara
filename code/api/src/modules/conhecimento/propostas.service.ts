import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { CONSULTA_OU } from './sql.js';

export interface DadosPropor {
  alteracao_id: string;
}

interface Afetada {
  resposta_id: string;
  pergunta_tipo: string;
  base_id: string;
  texto_voz: string;
  texto_sms: string | null;
  passa_a_pessoa_quando: string[];
}

interface TrechoCitado {
  id: string;
  referencia: string | null;
  texto: string;
  /** Este trecho é da fonte que mudou (e não da versão nova). */
  desta_fonte: boolean;
}

const SISTEMA_VOZ = `Atualizas respostas curadas de um serviço de atendimento municipal português (telefone e chat).
Uma fonte oficial mudou. Recebes a pergunta, a resposta atual, os trechos que ela citava e os trechos correspondentes da versão nova da fonte.
Regras:
- Muda só o que a fonte nova muda (valores, prazos, documentos, contactos, artigos). Se nada do que a resposta diz mudou, devolve a resposta atual tal como está.
- Mantém o tom, o tamanho e a forma de falar: frases curtas, português de Portugal, para ser dito em voz alta.
- Não inventes nada que não esteja nos trechos.
Devolve só o texto da resposta, sem aspas nem comentários.`;

const SISTEMA_SMS = `Escreves a versão SMS de uma resposta de um serviço de atendimento municipal português.
Recebes a resposta falada já atualizada e a versão SMS antiga. Atualiza a versão SMS com os mesmos factos da resposta falada, no máximo 300 caracteres, português de Portugal, sem emojis.
Devolve só o texto do SMS.`;

/**
 * Job `propor_respostas` (depois de uma alteração numa fonte): para cada
 * resposta afetada escreve uma versão nova em rascunho com o Claude e liga-a
 * a `alteracao_respostas.proposta_versao_id`. Nada vai para o ar sem alguém
 * aprovar a alteração no painel.
 *
 * Os trechos novos de cada citação: o da versão nova com a mesma
 * `referencia` ('art. 6.º'); sem referência, o mais parecido por texto.
 */
@Injectable()
export class PropostasService {
  private readonly logger = new Logger(PropostasService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly claude: ClaudeService,
  ) {}

  async correr({ alteracao_id }: DadosPropor): Promise<void> {
    if (!this.claude.disponivel) return;
    const [alt] = await this.db.query<{
      versao_nova_id: string;
      fonte_id: string;
    }>(
      `SELECT versao_nova_id, fonte_id FROM alteracoes WHERE id = $1 AND estado = 'por_rever'`,
      [alteracao_id],
    );
    if (!alt) return;

    const afetadas = await this.db.query<Afetada>(
      `SELECT r.id AS resposta_id, r.pergunta_tipo, rv.id AS base_id, rv.texto_voz,
              rv.texto_sms, rv.passa_a_pessoa_quando
       FROM alteracao_respostas ar
       JOIN respostas r ON r.id = ar.resposta_id
       JOIN resposta_versoes rv ON rv.id = coalesce(r.versao_no_ar_id,
         (SELECT id FROM resposta_versoes WHERE resposta_id = r.id ORDER BY numero DESC LIMIT 1))
       WHERE ar.alteracao_id = $1 AND ar.estado = 'proposta' AND ar.proposta_versao_id IS NULL`,
      [alteracao_id],
    );

    let falhas = 0;
    let ultimoErro: unknown = null;
    for (const a of afetadas) {
      try {
        await this.propor(alteracao_id, alt.fonte_id, alt.versao_nova_id, a);
      } catch (e) {
        falhas++;
        ultimoErro = e;
        this.logger.warn(
          `Proposta para a resposta ${a.resposta_id} falhou: ${(e as Error).message}`,
        );
      }
    }
    // Tudo falhou (IA em baixo): o job repete mais tarde.
    if (afetadas.length && falhas === afetadas.length) throw ultimoErro;
  }

  private async propor(
    alteracaoId: string,
    fonteId: string,
    versaoNovaId: string,
    a: Afetada,
  ): Promise<void> {
    const citados = await this.db.query<TrechoCitado>(
      `SELECT t.id, t.referencia, t.texto,
              (fv.fonte_id = $2 AND fv.id <> $3) AS desta_fonte
       FROM resposta_fontes rf
       JOIN trechos t ON t.id = rf.trecho_id
       JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
       WHERE rf.resposta_versao_id = $1
       ORDER BY t.ordem`,
      [a.base_id, fonteId, versaoNovaId],
    );
    const antigos = citados.filter((t) => t.desta_fonte);
    const outros = citados.filter((t) => !t.desta_fonte);

    const novos: TrechoCitado[] = [];
    for (const t of antigos) {
      const [n] = await this.db.query<TrechoCitado>(
        t.referencia
          ? `SELECT id, referencia, texto, false AS desta_fonte FROM trechos
             WHERE fonte_versao_id = $1 AND referencia = $2 ORDER BY ordem LIMIT 1`
          : `WITH c AS (${CONSULTA_OU(2)})
             SELECT t.id, t.referencia, t.texto, false AS desta_fonte
             FROM trechos t, c
             WHERE t.fonte_versao_id = $1 AND t.tsv @@ c.q
             ORDER BY ts_rank_cd(t.tsv, c.q, 32) DESC LIMIT 1`,
        [versaoNovaId, t.referencia ?? t.texto],
      );
      if (n && !novos.some((x) => x.id === n.id)) novos.push(n);
    }

    const bloco = (ts: TrechoCitado[]) =>
      ts.length
        ? ts
            .map((t) => `[${t.referencia ?? 'sem referência'}]\n${t.texto}`)
            .join('\n\n')
        : '(nenhum)';

    const textoVoz = await this.claude.escrever({
      tarefa: 'propor_resposta',
      sistema: SISTEMA_VOZ,
      esforco: 'medium',
      maxTokens: 2000,
      conteudo: [
        `Pergunta: ${a.pergunta_tipo}`,
        `Resposta atual:\n${a.texto_voz}`,
        `Trechos que a resposta citava (versão antiga):\n${bloco(antigos)}`,
        `Trechos correspondentes na versão nova:\n${bloco(novos)}`,
      ].join('\n\n'),
    });
    if (!textoVoz) throw new Error('A IA devolveu texto vazio.');

    let textoSms: string | null = null;
    if (a.texto_sms) {
      textoSms =
        (await this.claude.escrever({
          tarefa: 'propor_resposta',
          sistema: SISTEMA_SMS,
          esforco: 'low',
          maxTokens: 500,
          conteudo: `Resposta falada atualizada:\n${textoVoz}\n\nSMS antigo:\n${a.texto_sms}`,
        })) || a.texto_sms;
    }

    await this.db.transaction(async (tx) => {
      const [v] = await tx.query<{ id: string }>(
        `INSERT INTO resposta_versoes (resposta_id, numero, texto_voz, texto_sms, passa_a_pessoa_quando)
         SELECT $1, coalesce(max(numero), 0) + 1, $2, $3, $4
         FROM resposta_versoes WHERE resposta_id = $1
         RETURNING id`,
        [a.resposta_id, textoVoz, textoSms, a.passa_a_pessoa_quando],
      );
      const fontes = [...outros, ...novos].map((t) => t.id);
      if (fontes.length) {
        await tx.query(
          `INSERT INTO resposta_fontes (resposta_versao_id, trecho_id)
           SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
          [v.id, fontes],
        );
      }
      await tx.query(
        `UPDATE alteracao_respostas SET proposta_versao_id = $3
         WHERE alteracao_id = $1 AND resposta_id = $2`,
        [alteracaoId, a.resposta_id, v.id],
      );
    });
  }
}

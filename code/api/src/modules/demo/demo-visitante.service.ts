import { HttpStatus, Injectable, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { LicencasService } from '../licencas/licencas.service.js';
import {
  MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { PagamentosService } from '../pagamentos/pagamentos.service.js';
import { PONTOS } from './demo.conteudo.js';
import { diaDemo, eTelefoneDemonstracao, telefoneDemo } from './demo.regras.js';
import { DemoService } from './demo.service.js';

/** O estabelecimento fictício da licença de quem experimenta. */
export const ESTABELECIMENTO_VISITANTE = 'Café da Praça';

/**
 * Quem pede a licença por conta do visitante: um número da gama de
 * demonstração, para os SMS do pedido e da emissão não saírem. Depois a
 * licença passa para o número do visitante.
 */
const TELEFONE_PREPARACAO = telefoneDemo(990);

/** Telemóvel português (+351 9…). */
const TELEMOVEL = /^\+3519\d{8}$/;

/**
 * "Experimentar uma renovação" no /ligar: uma licença de esplanada de
 * demonstração no número de quem experimenta, a acabar daqui a 10 dias.
 * Na chamada, o assistente encontra-a pelo número e renova-a; os SMS da
 * renovação (a referência, e a licença depois de paga) chegam ao telemóvel
 * dessa pessoa. Só com a demonstração ligada (DEMO_ATIVA).
 */
@Injectable()
export class DemoVisitanteService {
  constructor(
    private readonly db: DatabaseService,
    private readonly ref: ModuleRef,
    private readonly demo: DemoService,
    private readonly municipios: MunicipiosService,
    private readonly municipes: MunicipesService,
  ) {}

  private svc<T>(tipo: Type<T>): T {
    return this.ref.get(tipo, { strict: false });
  }

  async licencaParaRenovar(slug: string, telefone: string) {
    if (!this.demo.ativa()) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'demo_desligada',
        'A demonstração está desligada neste servidor.',
      );
    }
    const e164 = normalizarTelefone(telefone);
    if (!e164 || !TELEMOVEL.test(e164)) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'telefone_invalido',
        'Escreva um número de telemóvel português.',
      );
    }
    if (eTelefoneDemonstracao(e164)) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'telefone_demonstracao',
        'Use o seu número: os números de demonstração não recebem SMS.',
      );
    }
    const m = await this.municipios.porSlug(slug);
    const visitante = await this.municipes.porTelefone(m.id, e164);
    if (!visitante) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'telefone_invalido',
        'Escreva um número de telemóvel português.',
      );
    }

    // Já tem uma por renovar (de outra tentativa)? A mesma serve.
    const [ja] = await this.db.query<{ numero: string; valida_ate: string }>(
      `SELECT p.numero, to_char(l.valida_ate, 'YYYY-MM-DD') AS valida_ate
       FROM licencas l JOIN processos p ON p.id = l.processo_id
       WHERE l.municipio_id = $1 AND l.municipe_id = $2 AND l.tipo = 'esplanada'
         AND l.estado = 'emitida' AND l.valida_ate >= current_date
         AND EXISTS (SELECT 1 FROM demo_registos d WHERE d.municipio_id = l.municipio_id
                     AND d.tipo = 'licenca' AND d.objeto_id = l.id)
         AND NOT EXISTS (SELECT 1 FROM licencas r WHERE r.renova_licenca_id = l.id
                         AND r.estado <> 'recusada')
       ORDER BY l.valida_ate LIMIT 1`,
      [m.id, visitante.id],
    );
    if (ja) {
      return {
        numero: ja.numero,
        valida_ate: ja.valida_ate,
        estabelecimento: ESTABELECIMENTO_VISITANTE,
        ja_existia: true,
      };
    }

    const agora = new Date();
    const ctx: ContextoFerramenta = {
      municipio: m,
      canal: 'telefone',
      conversaId: null,
      municipeId: null,
      telefone: TELEFONE_PREPARACAO,
    };
    const r = (await this.svc(RegistoFerramentas).executar(
      'pedir_licenca',
      ctx,
      {
        tipo: 'esplanada',
        dados: {
          estabelecimento: ESTABELECIMENTO_VISITANTE,
          morada: PONTOS.conde_margaride.morada,
          data_inicio: diaDemo(agora, m.fuso, 21),
          meses: 1,
          area_m2: 10,
          mesas: 4,
          passeio_livre_m: 2,
          estrado: false,
          centro_historico: false,
          nome: `${ESTABELECIMENTO_VISITANTE}, Lda`,
        },
      },
    )) as { numero?: string };
    const [l] = r.numero
      ? await this.db.query<{ id: string; processo_id: string }>(
          `SELECT l.id, l.processo_id FROM licencas l JOIN processos p ON p.id = l.processo_id
           WHERE p.numero = $1 AND p.municipio_id = $2`,
          [r.numero, m.id],
        )
      : [];
    if (!l) throw this.naoDeu();

    // Paga em modo de teste (o mesmo caminho do link do SMS) e emite.
    const [link] = await this.db.query<{ codigo: string }>(
      `SELECT lc.codigo FROM pagamentos pg
       JOIN links_curtos lc ON lc.destino_tipo = 'pagamento' AND lc.destino_id = pg.id
       WHERE pg.processo_id = $1 AND pg.estado = 'pendente'
       ORDER BY lc.expira_em DESC LIMIT 1`,
      [l.processo_id],
    );
    if (link)
      await this.svc(PagamentosService).simularPagamentoPublico(link.codigo);
    const licencas = this.svc(LicencasService);
    await licencas.sincronizar(m.id);
    if ((await this.estado(l.id)) === 'por_aprovar') {
      const f = await this.funcionario(m.id);
      if (f) await licencas.aprovar(m, f, l.id);
    }
    if ((await this.estado(l.id)) !== 'emitida') throw this.naoDeu();

    // Passa para o visitante: começou há 20 dias e acaba daqui a 10 (a
    // renovação começa a seguir e tem de ter 5 dias úteis de antecedência).
    const acaba = diaDemo(agora, m.fuso, 10);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE licencas SET municipe_id = $2, valida_ate = $3::date,
           dados = jsonb_set(dados, '{data_inicio}', to_jsonb($4::text))
         WHERE id = $1`,
        [l.id, visitante.id, acaba, diaDemo(agora, m.fuso, -20)],
      );
      await tx.query('UPDATE processos SET municipe_id = $2 WHERE id = $1', [
        l.processo_id,
        visitante.id,
      ]);
      await tx.query(
        `INSERT INTO demo_registos (municipio_id, chave, tipo, objeto_id)
         VALUES ($1, $2, 'licenca', $3) ON CONFLICT (municipio_id, chave) DO NOTHING`,
        [m.id, `licenca:visitante:${l.id}`, l.id],
      );
    });
    return {
      numero: r.numero!,
      valida_ate: acaba,
      estabelecimento: ESTABELECIMENTO_VISITANTE,
      ja_existia: false,
    };
  }

  private async estado(id: string): Promise<string | null> {
    const [r] = await this.db.query<{ estado: string }>(
      'SELECT estado FROM licencas WHERE id = $1',
      [id],
    );
    return r?.estado ?? null;
  }

  /** Quem aprova, se a câmara pôs "um funcionário confirma" (como no Preparar demo). */
  private async funcionario(
    municipioId: string,
  ): Promise<UtilizadorPainel | null> {
    const [f] = await this.db.query<{
      id: string;
      nome: string;
      email: string;
      perfil: UtilizadorPainel['perfil'];
    }>(
      `SELECT id, nome, email, perfil FROM utilizadores
       WHERE municipio_id = $1 AND ativo
         AND perfil IN ('chefe_divisao', 'tecnico', 'atendimento')
       ORDER BY (perfil <> 'chefe_divisao'), (perfil <> 'tecnico'), criado_em
       LIMIT 1`,
      [municipioId],
    );
    return f ? ({ ...f, municipioId } as UtilizadorPainel) : null;
  }

  private naoDeu() {
    return new ErroApi(
      HttpStatus.CONFLICT,
      'licenca_por_criar',
      'Não foi possível preparar a licença de demonstração. Tente outra vez.',
    );
  }
}

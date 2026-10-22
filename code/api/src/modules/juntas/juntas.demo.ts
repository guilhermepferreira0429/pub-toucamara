import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { proximoNumero } from '../../common/numeracao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import {
  contextoMunicipio,
  DatabaseService,
} from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { IngestaoService } from '../conhecimento/ingestao.service.js';
import { telefoneDemo } from '../demo/demo.regras.js';
import { MunicipesService } from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  AGENTE_JUNTA_DEMO,
  ATESTADOS_JUNTA_DEMO,
  CATEGORIAS_JUNTA_DEMO,
  emailUtilizadorDemo,
  FONTES_JUNTA_DEMO,
  FREGUESIA_DEMO,
  NOME_JUNTA_DEMO,
  slugJuntaDemo,
  textoFonte,
  UTILIZADORES_JUNTA_DEMO,
} from './juntas.conteudo.js';
import { randomInt } from 'crypto';

const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export interface ResultadoJuntaDemo {
  criada: boolean;
  junta: { id: string; slug: string; nome: string };
  utilizadores: { email: string; perfil: string }[];
  fontes_novas: number;
  atestados_novos: number;
}

/**
 * A junta de demonstração do "Preparar demo": a junta como tenant (ligada
 * à câmara), o agente, dois utilizadores do painel, as entidades, o
 * conhecimento dos serviços da junta, as categorias de ocorrência e dois
 * pedidos de atestado por emitir. Idempotente (tudo por chave natural).
 */
@Injectable()
export class JuntasDemoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly ref: ModuleRef,
    private readonly municipes: MunicipesService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** null quando o município já é uma junta (não há juntas de juntas). */
  async preparar(
    camara: Municipio,
    u: UtilizadorPainel | null,
  ): Promise<ResultadoJuntaDemo | null> {
    if (camara.tipo === 'junta') return null;
    // Escreve no tenant da junta: fora do contexto do painel da câmara (o
    // RLS só deixaria escrever na câmara). Só a chefia da câmara chega aqui
    // (recurso 'demo') e só com a demonstração ligada.
    return contextoMunicipio.exit(() => this.criar(camara, u));
  }

  private async criar(
    camara: Municipio,
    u: UtilizadorPainel | null,
  ): Promise<ResultadoJuntaDemo> {
    const slug = slugJuntaDemo(camara.slug);
    const [nova] = await this.db.query<{ id: string }>(
      `INSERT INTO municipios (slug, nome, fuso, tipo, concelho_id, freguesias, demonstracao)
       VALUES ($1, $2, $3, 'junta', $4, $5, true)
       ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [slug, NOME_JUNTA_DEMO, camara.fuso, camara.id, [FREGUESIA_DEMO]],
    );
    const juntaId =
      nova?.id ??
      (
        await this.db.query<{ id: string }>(
          'SELECT id FROM municipios WHERE slug = $1',
          [slug],
        )
      )[0].id;

    await this.db.query(
      `INSERT INTO agente_config (municipio_id, nome, saudacao, versao)
       VALUES ($1, $2, $3, $4) ON CONFLICT (municipio_id) DO NOTHING`,
      [
        juntaId,
        AGENTE_JUNTA_DEMO.nome,
        AGENTE_JUNTA_DEMO.saudacao,
        AGENTE_JUNTA_DEMO.versao,
      ],
    );

    const utilizadores: ResultadoJuntaDemo['utilizadores'] = [];
    for (const x of UTILIZADORES_JUNTA_DEMO) {
      const email = emailUtilizadorDemo(slug, x.chave);
      await this.db.query(
        `INSERT INTO utilizadores (municipio_id, email, nome, perfil)
         VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`,
        [juntaId, email, x.nome, x.perfil],
      );
      utilizadores.push({ email, perfil: x.perfil });
    }

    const entidade = async (nome: string, tipo: string, descricao: string) => {
      const [e] = await this.db.query<{ id: string }>(
        `INSERT INTO entidades (municipio_id, nome, tipo, descricao)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (municipio_id, nome) DO UPDATE SET ativo = entidades.ativo
         RETURNING id`,
        [juntaId, nome, tipo, descricao],
      );
      return e.id;
    };
    const entidadeJunta = await entidade(
      NOME_JUNTA_DEMO,
      'junta',
      'Junta de freguesia (demonstração): atestados, prova de vida, cães, cemitério, feiras e caminhos.',
    );
    const nomeCamara = `Câmara Municipal de ${camara.nome}`;
    const entidadeCamara = await entidade(
      nomeCamara,
      'camara',
      'A câmara do concelho: obras, licenças, urbanismo, plano diretor, taxas municipais.',
    );
    const [linha] = await this.db.query<{ telefone_linha: string | null }>(
      'SELECT telefone_linha FROM municipios WHERE id = $1',
      [camara.id],
    );
    if (linha?.telefone_linha) {
      await this.db.query(
        `INSERT INTO entidade_contactos (entidade_id, tipo, rotulo, valor)
         SELECT $1, 'telefone', 'Linha Tou, Câmara?', $2
         WHERE NOT EXISTS (SELECT 1 FROM entidade_contactos WHERE entidade_id = $1)`,
        [entidadeCamara, linha.telefone_linha],
      );
    }

    const ingestao = this.ref.get(IngestaoService, { strict: false });
    let fontesNovas = 0;
    for (const f of FONTES_JUNTA_DEMO) {
      const [fonte] = await this.db.query<{ id: string }>(
        `INSERT INTO fontes (municipio_id, entidade_id, titulo, tipo, url, ler_a_cada,
                             leitura_automatica, demonstracao)
         VALUES ($1, $2, $3, $4, $5, interval '365 days', false, true)
         ON CONFLICT (municipio_id, url) DO NOTHING RETURNING id`,
        [
          juntaId,
          entidadeJunta,
          f.titulo,
          f.tipo,
          `https://demonstracao.toucamara.pt/juntas/${slug}/${f.chave}`,
        ],
      );
      if (!fonte) continue;
      await ingestao.registarTexto(fonte.id, textoFonte(f, nomeCamara));
      fontesNovas++;
    }

    for (const c of CATEGORIAS_JUNTA_DEMO) {
      await this.db.query(
        `INSERT INTO categorias_ocorrencia (municipio_id, nome, icone)
         VALUES ($1, $2, $3) ON CONFLICT (municipio_id, nome) DO NOTHING`,
        [juntaId, c.nome, c.icone],
      );
    }

    let atestadosNovos = 0;
    for (const a of ATESTADOS_JUNTA_DEMO) {
      const criado = await this.db.transaction(async (tx) => {
        const m = await this.municipes.porTelefone(
          juntaId,
          telefoneDemo(a.telefone),
          tx,
        );
        if (!m) return false;
        const [ja] = await tx.query<{ id: string }>(
          'SELECT id FROM atestados WHERE municipio_id = $1 AND municipe_id = $2 LIMIT 1',
          [juntaId, m.id],
        );
        if (ja) return false;
        await this.municipes.atualizar(m.id, { nome: a.nome }, tx);
        const ano = new Date().getFullYear();
        const numero = `AT ${await proximoNumero(tx, juntaId, 'AT', ano)}/${ano}`;
        await tx.query(
          `INSERT INTO atestados (municipio_id, numero, tipo, municipe_id, nome, morada, freguesia,
             finalidade, dados, canal, codigo_verificacao)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'telefone', $10)`,
          [
            juntaId,
            numero,
            a.tipo,
            m.id,
            a.nome,
            a.morada,
            FREGUESIA_DEMO,
            a.finalidade,
            JSON.stringify('agregado' in a ? { agregado: a.agregado } : {}),
            Array.from(
              { length: 10 },
              () => ALFABETO[randomInt(ALFABETO.length)],
            ).join(''),
          ],
        );
        return true;
      });
      if (criado) atestadosNovos++;
    }

    if (nova) {
      await this.auditoria.registar({
        municipioId: camara.id,
        atorTipo: u ? 'utilizador' : 'sistema',
        atorId: u?.id ?? null,
        acao: 'criar_junta_demonstracao',
        objetoTipo: 'junta',
        objetoId: juntaId,
        dados: { slug, nome: NOME_JUNTA_DEMO },
      });
    }
    return {
      criada: !!nova,
      junta: { id: juntaId, slug, nome: NOME_JUNTA_DEMO },
      utilizadores,
      fontes_novas: fontesNovas,
      atestados_novos: atestadosNovos,
    };
  }
}

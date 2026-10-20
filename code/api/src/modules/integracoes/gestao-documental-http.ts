import {
  DocumentoGd,
  ErroGestaoDocumental,
  GestaoDocumental,
  ProcessoGd,
} from './gestao-documental.js';

/**
 * Esqueleto de um adaptador real (MyDoc, SmartDocs, WebDoc e afins). Só a
 * forma: não faz chamadas e não está na lista de adaptadores que o painel
 * deixa escolher. Ligar um sistema concreto é preencher estes três métodos
 * com a API dele e acrescentar o nome a `ADAPTADORES` (e ao CHECK da
 * `gestao_documental_config`).
 *
 * O que estes sistemas costumam expor (confirmar com a documentação e um
 * ambiente de testes do fornecedor da câmara):
 *  - um serviço web REST/JSON ou SOAP, autenticado por chave de API, OAuth2
 *    (client credentials) ou certificado de cliente, muitas vezes só dentro
 *    da rede da câmara (VPN ou IP autorizado);
 *  - registo de entrada: livro/série, classificação (plano de classificação
 *    da câmara, ex. MEF), assunto, requerente (entidade do sistema: procurar
 *    por NIF ou criar), unidade orgânica de destino → devolve o número de
 *    registo ('2026/E/012345') e um id interno;
 *  - anexos: envio do ficheiro (multipart ou base64) associado ao registo,
 *    com tipo documental;
 *  - estado/workflow: passar o processo de etapa ou acrescentar uma nota.
 */
export interface ConfigGestaoDocumentalHttp {
  /** 'https://gd.cm-exemplo.pt/api'. */
  url: string;
  /** Vem do cofre de segredos, nunca da BD em claro. */
  credencial: string;
  /** Livro de registo de entrada. */
  livro: string;
  /** Tipo de processo ('CP') → classificação no sistema da câmara. */
  classificacoes: Record<string, string>;
  /** Fase nossa ('apreciacao') → etapa no sistema da câmara. */
  etapas: Record<string, string>;
  /** Para ir buscar o ficheiro de cada documento (ArmazenamentoService.ler). */
  lerFicheiro: (chave: string) => Promise<Buffer>;
}

export class GestaoDocumentalHttp implements GestaoDocumental {
  constructor(private readonly cfg: ConfigGestaoDocumentalHttp) {}

  /*
   * POST {url}/registos
   * { livro, classificacao: classificacoes[p.tipo_codigo], assunto,
   *   requerente, referencia_externa: p.numero, data: p.criado_em }
   * → { numero: '2026/E/012345', id }
   * A `referencia_externa` (o nosso número) serve de chave de idempotência:
   * se a resposta se perder, o reintento encontra o registo em vez de criar
   * outro.
   */
  registarProcesso(p: ProcessoGd): Promise<{ gd_id: string }> {
    return this.porLigar(`registar ${p.numero} em ${this.cfg.url}`);
  }

  /*
   * POST {url}/registos/{gdId}/anexos (multipart: ficheiro + metadados)
   * ficheiro = await cfg.lerFicheiro(doc.ficheiro_key)
   * → { id } (a referência do anexo)
   */
  anexarDocumento(
    gdId: string,
    doc: DocumentoGd,
  ): Promise<{ referencia: string | null }> {
    return this.porLigar(`anexar ${doc.id} a ${gdId}`);
  }

  /* POST {url}/registos/{gdId}/etapas { etapa: etapas[fase] } */
  atualizarEstado(gdId: string, fase: string): Promise<void> {
    return this.porLigar(`passar ${gdId} para ${fase}`);
  }

  private porLigar(o: string): Promise<never> {
    return Promise.reject(
      new ErroGestaoDocumental(
        `Adaptador da gestão documental por ligar (${o}).`,
      ),
    );
  }
}

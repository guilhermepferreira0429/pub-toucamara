import { HttpStatus } from '@nestjs/common';
import { createHash } from 'crypto';
import { ErroApi } from '../../common/erros.js';
import {
  nifValido,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import type { IdentidadeCidadao } from './regras.js';

/*
 * Autenticar o munícipe antes de entregar em nome dele. Um adaptador por
 * fornecedor, todos com esta forma (como a gestão documental):
 *
 *  - `simulada` (por omissão): uma página nossa imita o passo "autorizar
 *    com Chave Móvel Digital" — telemóvel e PIN de demonstração — e devolve
 *    a identidade que a câmara já tem do requerente, com nível de garantia
 *    'simulado'. Sem validade legal, e di-lo em todo o lado.
 *  - `cmd`: o Fornecedor de Autenticação do Estado (autenticacao.gov, AMA),
 *    para a Chave Móvel Digital e o Cartão de Cidadão. Esqueleto: precisa da
 *    credenciação na AMA (ver docs/CREDENCIAIS_EXTERNAS.md).
 */

export const MODOS_AUTENTICACAO = ['simulada', 'cmd'] as const;
export type ModoAutenticacao = (typeof MODOS_AUTENTICACAO)[number];

export interface InicioAutenticacao {
  /** Aleatório, vai na URL e volta no retorno (só o hash fica na BD). */
  state: string;
  nonce: string;
  /** PKCE (onde o protocolo o tiver). */
  verificador: string;
  /** Página da web da entrega (`${WEB_URL}/entrega/{token}`). */
  urlPaginaEntrega: string;
}

export interface RetornoAutenticacao {
  /** O que o fornecedor (ou a página simulada) devolveu: code, state, PIN... */
  parametros: Record<string, string | undefined>;
  nonce: string;
  verificador: string;
  /** O que a câmara já sabe do requerente (só a simulação o usa). */
  esperado: {
    nome: string | null;
    nif: string | null;
    telefone: string | null;
  };
}

export interface AutenticacaoCidadao {
  readonly modo: ModoAutenticacao;
  readonly simulada: boolean;
  /** Variáveis de ambiente em falta para este modo funcionar ([] = pronto). */
  emFalta(): string[];
  /** O endereço para onde o browser da pessoa vai autenticar-se. */
  iniciar(p: InicioAutenticacao): Promise<{ url: string }>;
  /** Valida o retorno e devolve quem se autenticou. */
  retorno(p: RetornoAutenticacao): Promise<IdentidadeCidadao>;
}

/** O modo pedido não pode ser usado: falta configuração ou credenciação. */
export function erroPorConfigurar(emFalta: string[]): ErroApi {
  return new ErroApi(
    HttpStatus.SERVICE_UNAVAILABLE,
    'autenticacao_por_configurar',
    'Autenticação com Chave Móvel Digital por configurar — falta a credenciação na AMA.',
    { em_falta: emFalta },
  );
}

// ------------------------------------------------------------- simulada

/** PIN da demonstração, mostrado na própria página. */
export const PIN_DEMONSTRACAO = '1234';

export class AutenticacaoSimulada implements AutenticacaoCidadao {
  readonly modo = 'simulada' as const;
  readonly simulada = true;

  emFalta(): string[] {
    return [];
  }

  iniciar(p: InicioAutenticacao): Promise<{ url: string }> {
    const u = new URL(`${p.urlPaginaEntrega}/autorizar`);
    u.searchParams.set('estado', p.state);
    return Promise.resolve({ url: u.toString() });
  }

  retorno(p: RetornoAutenticacao): Promise<IdentidadeCidadao> {
    const { telefone, pin, nif } = p.parametros;
    if (pin !== PIN_DEMONSTRACAO) {
      return Promise.reject(
        new ErroApi(
          HttpStatus.FORBIDDEN,
          'pin_errado',
          `PIN errado. Nesta demonstração o PIN é ${PIN_DEMONSTRACAO}.`,
        ),
      );
    }
    if (
      p.esperado.telefone &&
      normalizarTelefone(telefone) !== p.esperado.telefone
    ) {
      return Promise.reject(
        new ErroApi(
          HttpStatus.FORBIDDEN,
          'telefone_diferente',
          'Esse número não é o do requerente. Use o número para onde enviámos o SMS.',
        ),
      );
    }
    // A câmara já tem o NIF: é esse que a "Chave Móvel Digital" devolve. Sem
    // ele, a pessoa escreve-o na página simulada.
    const nifDado = nif?.replace(/\D/g, '') ?? '';
    const nifFinal = p.esperado.nif ?? (nifValido(nifDado) ? nifDado : null);
    if (!p.esperado.nif && nifDado && !nifFinal) {
      return Promise.reject(
        new ErroApi(
          HttpStatus.BAD_REQUEST,
          'nif_invalido',
          'Esse NIF não é válido.',
        ),
      );
    }
    return Promise.resolve({
      nif: nifFinal,
      nome: p.esperado.nome,
      nivel_garantia: 'simulado',
      fornecedor: 'simulacao',
      simulada: true,
    });
  }
}

// ------------------------------------------------------------------ cmd

/**
 * Configuração do Fornecedor de Autenticação do Estado. Os valores reais só
 * existem depois da adesão na AMA; o protocolo (SAML 2.0 ou OAuth 2.0) e os
 * atributos pedidos ficam a confirmar com a AMA.
 */
export interface ConfigCmd {
  protocolo: string;
  /** Ex.: o ambiente de testes da AMA, e depois o de produção. */
  urlBase: string;
  clientId: string;
  samlEntityId: string;
  samlCertificado: string;
  samlChavePrivada: string;
  /** Atributos pedidos ao fornecedor (NIF e nome completo, pelo menos). */
  atributos: string;
  /** {API_URL}/v1/public/entregas/autenticacao/retorno — registado na AMA. */
  urlRetorno: string;
}

export function emFaltaCmd(c: ConfigCmd): string[] {
  const falta: string[] = [];
  if (c.protocolo !== 'saml' && c.protocolo !== 'oauth2')
    falta.push('CMD_PROTOCOLO');
  if (!c.urlBase) falta.push('CMD_URL_BASE');
  if (c.protocolo === 'oauth2' && !c.clientId) falta.push('CMD_CLIENT_ID');
  if (c.protocolo === 'saml') {
    if (!c.samlEntityId) falta.push('CMD_SAML_ENTITY_ID');
    if (!c.samlCertificado) falta.push('CMD_SAML_CERTIFICADO');
    if (!c.samlChavePrivada) falta.push('CMD_SAML_CHAVE_PRIVADA');
  }
  if (!c.atributos) falta.push('CMD_ATRIBUTOS');
  return falta;
}

/**
 * Esqueleto do adaptador real. Sem configuração recusa logo, com a mensagem
 * da credenciação. Com configuração monta o pedido de autenticação, mas a
 * validação do retorno fica por ligar até haver o ambiente de testes da AMA
 * para a confirmar (assinatura da resposta, atributos, nível de garantia).
 *
 * O que ligar, quando houver credenciação:
 *  - SAML 2.0: AuthnRequest assinado com o certificado da entidade
 *    (CMD_SAML_*), atributos pedidos em CMD_ATRIBUTOS; a resposta chega por
 *    POST ao URL de retorno e tem de ser validada (assinatura, destinatário,
 *    validade, InResponseTo = o state guardado).
 *  - OAuth 2.0: autorização com client_id e redirect_uri registados; depois
 *    os atributos pedidos ao serviço de atributos do fornecedor.
 *  - Em ambos: tirar o NIF e o nome, mapear o nível de garantia e devolver
 *    `simulada: false`.
 */
export class AutenticacaoCmd implements AutenticacaoCidadao {
  readonly modo = 'cmd' as const;
  readonly simulada = false;

  constructor(private readonly cfg: ConfigCmd) {}

  emFalta(): string[] {
    return emFaltaCmd(this.cfg);
  }

  private exigirConfiguracao() {
    const falta = this.emFalta();
    if (falta.length) throw erroPorConfigurar(falta);
  }

  iniciar(p: InicioAutenticacao): Promise<{ url: string }> {
    try {
      this.exigirConfiguracao();
    } catch (e) {
      return Promise.reject(e as Error);
    }
    const base = this.cfg.urlBase.replace(/\/$/, '');
    if (this.cfg.protocolo === 'oauth2') {
      // Caminho e parâmetros a confirmar com a documentação da AMA.
      const u = new URL(`${base}/oauth/askauthorization`);
      u.search = new URLSearchParams({
        client_id: this.cfg.clientId,
        redirect_uri: this.cfg.urlRetorno,
        scope: this.cfg.atributos,
        response_type: 'code',
        state: p.state,
        code_challenge: createHash('sha256')
          .update(p.verificador)
          .digest('base64url'),
        code_challenge_method: 'S256',
      }).toString();
      return Promise.resolve({ url: u.toString() });
    }
    return Promise.reject(
      new ErroApi(
        HttpStatus.NOT_IMPLEMENTED,
        'autenticacao_por_ligar',
        'O pedido SAML à autenticacao.gov ainda não está ligado: falta o ambiente de testes da AMA para o validar.',
      ),
    );
  }

  retorno(): Promise<IdentidadeCidadao> {
    try {
      this.exigirConfiguracao();
    } catch (e) {
      return Promise.reject(e as Error);
    }
    return Promise.reject(
      new ErroApi(
        HttpStatus.NOT_IMPLEMENTED,
        'autenticacao_por_ligar',
        'A validação da resposta da autenticacao.gov ainda não está ligada: falta o ambiente de testes da AMA para a confirmar.',
      ),
    );
  }
}

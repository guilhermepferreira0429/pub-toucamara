import Anthropic from '@anthropic-ai/sdk';
import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { iaConfig } from '../../config/configuration.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { tokensDe } from '../../ia/precos.js';
import { UsoIaService } from '../../ia/uso-ia.service.js';
import {
  blocoFicheiro,
  MimeVisao,
  MIMES_VISAO,
} from '../../ia/visao.service.js';
import { Metadados, METADADOS_VAZIOS, TIPOS_ARQUIVO } from './metadados.js';

// Fixo para ficar em cache: nada de datas, nomes ou ids aqui.
const SISTEMA_OCR = `Transcreves documentos antigos digitalizados do arquivo de uma câmara municipal portuguesa (processos de obras, licenças, requerimentos, plantas com legendas).
Devolve só o texto que se lê, pela ordem de leitura, página a página (uma linha em branco entre páginas).
- Mantém a ortografia original (incluindo a antiga: "projecto", "pharmacia"), os números e as datas tal como estão.
- Texto manuscrito: transcreve o que se percebe; uma palavra que não se lê fica [ilegível].
- Carimbos, selos e assinaturas: escreve [carimbo: ...], [selo], [assinatura].
- Não resumas, não comentes e não inventes o que não se vê.`;

const SISTEMA_METADADOS = `Lês o texto de um processo antigo do arquivo de uma câmara municipal portuguesa e preenches os metadados pedidos.
- Só com o que está no texto: o que não aparece fica null. Não deduzas a freguesia a partir da rua.
- numero_antigo: o número do processo como está escrito (ex.: "123/1987" ou "45/82"), sem "Proc." nem "n.º".
- ano: o ano do processo (o do número, ou a data de entrada), com quatro algarismos.
- requerente: o nome de quem pediu (não o do técnico, do presidente ou do notário).
- morada: o local da obra ou do prédio; se não houver, a morada do requerente.
- artigo_matricial: só o número do artigo da matriz predial (com U- ou R- se vier).`;

const esquemaMetadadosIa = z.object({
  numero_antigo: z.string().nullable(),
  ano: z.number().int().nullable(),
  tipo: z
    .enum(TIPOS_ARQUIVO)
    .nullable()
    .describe(
      'obras (construção, alteração, ampliação), loteamento, utilizacao (licença de utilização/habitação), demolicao, ocupacao_via, publicidade, outro.',
    ),
  requerente: z.string().nullable(),
  morada: z.string().nullable(),
  freguesia: z.string().nullable(),
  artigo_matricial: z.string().nullable(),
});

const RECURSO = {
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
} as const;

/**
 * A IA no arquivo: transcrição (OCR) das digitalizações sem camada de texto
 * e leitura dos metadados. Sem ANTHROPIC_API_KEY `disponivel` é false e o
 * arquivo segue sem ela (regras para os metadados; "por transcrever").
 */
@Injectable()
export class ArquivoIaService {
  private readonly logger = new Logger(ArquivoIaService.name);
  private readonly cliente: Anthropic | null;
  private readonly modelo: string;

  constructor(
    config: ConfigService,
    private readonly claude: ClaudeService,
    @Optional() private readonly uso?: UsoIaService,
  ) {
    const cfg = config.getOrThrow<ConfigType<typeof iaConfig>>('ia');
    this.modelo = cfg.modelo;
    this.cliente = cfg.apiKey ? new Anthropic({ apiKey: cfg.apiKey }) : null;
  }

  get disponivel(): boolean {
    return this.cliente !== null && this.claude.disponivel;
  }

  /** O Claude lê PDFs e JPEG/PNG/WebP/GIF; TIFF fica por transcrever. */
  podeLer(mime: string): mime is MimeVisao {
    return (MIMES_VISAO as readonly string[]).includes(mime);
  }

  /** O texto de uma digitalização (PDF ou imagem). */
  async transcrever(ficheiro: Buffer, mime: MimeVisao): Promise<string> {
    if (!this.cliente) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ia_indisponivel',
        'O assistente de IA não está ligado nesta instalação.',
      );
    }
    const cliente = this.cliente;
    let resposta: Anthropic.Beta.BetaMessage;
    try {
      resposta = await cliente.beta.messages.create({
        ...RECURSO,
        betas: [...RECURSO.betas],
        model: this.modelo,
        max_tokens: 16000,
        system: [
          {
            type: 'text',
            text: SISTEMA_OCR,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              blocoFicheiro(ficheiro, mime),
              { type: 'text', text: 'Transcreve este documento.' },
            ],
          },
        ],
        output_config: { effort: 'low' },
      });
      void this.uso?.registar({
        tarefa: 'ocr_arquivo',
        modelo: this.modelo,
        resultado: resposta.stop_reason === 'refusal' ? 'recusa' : 'ok',
        tokens: tokensDe(resposta.usage),
      });
    } catch (e) {
      this.logger.warn(`OCR falhou: ${(e as Error).message}`);
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ia_indisponivel',
        'A transcrição pela IA falhou. Tentar daqui a pouco.',
      );
    }
    if (resposta.stop_reason === 'refusal') {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'ia_recusou',
        'A IA recusou transcrever este documento.',
      );
    }
    return resposta.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('')
      .trim();
  }

  /** Os metadados do texto (IA). Valores fora do esquema ficam null. */
  async metadados(
    texto: string,
    anoAtual = new Date().getFullYear(),
  ): Promise<Metadados> {
    const r = await this.claude.extrair(esquemaMetadadosIa, {
      tarefa: 'metadados_arquivo',
      sistema: SISTEMA_METADADOS,
      conteudo: texto.slice(0, 60_000),
      esforco: 'low',
      maxTokens: 2000,
    });
    const curto = (s: string | null, max: number) => {
      const t = s?.replace(/\s+/g, ' ').trim();
      return t ? t.slice(0, max) : null;
    };
    return {
      ...METADADOS_VAZIOS,
      numero_antigo: curto(r.numero_antigo, 40),
      ano: r.ano && r.ano >= 1800 && r.ano <= anoAtual ? r.ano : null,
      tipo: r.tipo,
      requerente: curto(r.requerente, 120),
      morada: curto(r.morada, 160),
      freguesia: curto(r.freguesia, 80),
      artigo_matricial: curto(r.artigo_matricial, 30),
    };
  }
}

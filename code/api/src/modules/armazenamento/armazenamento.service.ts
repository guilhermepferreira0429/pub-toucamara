import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { ErroApi } from '../../common/erros.js';
import { armazenamentoConfig } from '../../config/configuration.js';

export type PastaFicheiro =
  | 'gravacoes'
  | 'fotos-ocorrencias'
  | 'documentos'
  | 'requerimentos'
  | 'relatorios'
  | 'fontes';

/**
 * Ficheiros em S3 compatível na UE. Na BD guarda-se só a chave. O browser
 * envia e lê diretamente com URLs assinadas: a API não carrega ficheiros.
 * Sem S3_BUCKET responde 503 (nunca se finge que guardou).
 */
@Injectable()
export class ArmazenamentoService {
  private readonly cliente: S3Client | null;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const cfg =
      config.getOrThrow<ConfigType<typeof armazenamentoConfig>>(
        'armazenamento',
      );
    this.bucket = cfg.bucket;
    this.cliente = cfg.bucket
      ? new S3Client({
          region: cfg.region,
          endpoint: cfg.endpoint || undefined,
          forcePathStyle: !!cfg.endpoint,
          credentials: cfg.accessKey
            ? { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey }
            : undefined,
        })
      : null;
  }

  get disponivel(): boolean {
    return this.cliente !== null;
  }

  /** 'guimaraes/fotos-ocorrencias/2026/10/<uuid>.jpg' */
  chave(municipioSlug: string, pasta: PastaFicheiro, extensao: string): string {
    const agora = new Date();
    const mes = String(agora.getUTCMonth() + 1).padStart(2, '0');
    return `${municipioSlug}/${pasta}/${agora.getUTCFullYear()}/${mes}/${randomUUID()}.${extensao.replace(/^\./, '')}`;
  }

  /** URL para o browser enviar o ficheiro (PUT), válida 10 minutos. */
  async urlEnvio(chave: string, mime: string): Promise<string> {
    return getSignedUrl(
      this.s3(),
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: chave,
        ContentType: mime,
      }),
      { expiresIn: 600 },
    );
  }

  /** URL para ler, válida 5 minutos (gravações: registar no audit_log). */
  async urlLeitura(chave: string, minutos = 5): Promise<string> {
    return getSignedUrl(
      this.s3(),
      new GetObjectCommand({ Bucket: this.bucket, Key: chave }),
      { expiresIn: minutos * 60 },
    );
  }

  /** Guarda a partir da API (PDFs gerados, gravações vindas do ElevenLabs). */
  async guardar(chave: string, conteudo: Buffer, mime: string): Promise<void> {
    await this.s3().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: chave,
        Body: conteudo,
        ContentType: mime,
      }),
    );
  }

  /**
   * Apaga ficheiros (retenção RGPD). Devolve as chaves que ficaram apagadas;
   * as que falharem ficam para a próxima noite. No Wasabi cada ficheiro paga
   * pelo menos 90 dias, apagado ou não: apaga-se na mesma por causa do RGPD.
   */
  async apagar(chaves: string[]): Promise<string[]> {
    const apagadas: string[] = [];
    for (let i = 0; i < chaves.length; i += 1000) {
      const lote = chaves.slice(i, i + 1000);
      const r = await this.s3().send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: lote.map((Key) => ({ Key })), Quiet: false },
        }),
      );
      const falharam = new Set((r.Errors ?? []).map((e) => e.Key));
      apagadas.push(...lote.filter((k) => !falharam.has(k)));
    }
    return apagadas;
  }

  async ler(chave: string): Promise<Buffer> {
    const r = await this.s3().send(
      new GetObjectCommand({ Bucket: this.bucket, Key: chave }),
    );
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  private s3(): S3Client {
    if (!this.cliente) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'armazenamento_indisponivel',
        'Armazenamento de ficheiros por configurar (S3_BUCKET).',
      );
    }
    return this.cliente;
  }
}

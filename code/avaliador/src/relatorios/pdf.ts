/* PDF a partir do HTML autónomo, com o Chromium do Playwright (sem pdfkit). */
import { chromium } from 'playwright';

export async function htmlParaPdf(
  html: string,
  destino: string,
): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Tudo embebido: não há rede a esperar.
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: destino,
      format: 'A4',
      printBackground: true, // o fundo creme faz parte da identidade
      margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
    });
  } finally {
    await browser.close();
  }
}

"""
Gera perguntas-base.json a partir de "Câmara Atende — Perguntas de teste.pdf".

Corre-se uma vez (o JSON fica no repo e é ele a fonte de verdade a partir daí;
correções à mão vão para o JSON, não para aqui):

    python code/avaliador/src/perguntas/extrair-pdf.py

Precisa de PyMuPDF (`pip install pymupdf`).

Porque é assim:
- As categorias estão fixas na lista abaixo: são títulos de secção sem
  marcação no PDF, e adivinhá-los pelo tamanho da letra é mais frágil do que
  escrevê-los. Se o documento mudar de categorias, o script falha alto.
- A numeração no PDF recomeça em cada categoria; na BD `ordem` é única por
  conjunto, por isso a `ordem` do JSON é global (1..N, pela ordem do PDF).
- Algumas perguntas partem-se em duas linhas no PDF: as linhas sem número
  depois de uma pergunta são continuação dela.
"""

import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[3]  # code/avaliador/src/perguntas -> raiz do repo
PDF = RAIZ / "docs" / "material" / "Câmara Atende — Perguntas de teste.pdf"
SAIDA = AQUI / "perguntas-base.json"

CATEGORIAS = [
    "Obras e urbanismo",
    "Licenças de atividade, comércio e espaço público",
    "Taxas e pagamentos",
    "Lixo, ambiente e limpeza",
    "Água e saneamento",
    "Trânsito e estacionamento",
    "Educação e ação social",
    "Cultura, desporto e eventos",
    "Atendimento, documentos e contactos",
    "Animais, cemitérios e habitação",
    "Ocorrências na via pública",
    "Perguntas difíceis",
]
DIFICEIS = "Perguntas difíceis"

# Cabeçalho e rodapé repetidos em cada página.
RUIDO = re.compile(r"^(Câmara Atende — Perguntas de teste|Page \d+ of \d+)$")
NUMERADA = re.compile(r"^(\d+)\.\s+(.*)$")
PARENTESES = re.compile(r"^(.*?)\s*\(([^()]*)\)\s*$")


def comportamento_dificil(nota: str) -> tuple[str, str | None, str]:
    """(comportamento, entidade_esperada, idioma) a partir da indicação
    entre parênteses das "Perguntas difíceis". Falha se aparecer uma nova:
    é melhor decidir à mão do que mapear mal."""
    n = nota.lower()
    if n == "não é da câmara":
        # Cartão de cidadão: Registos e Notariado (ou Espaço Cidadão).
        return "fora_ambito", "IRN", "pt-PT"
    if n == "finanças":
        return "fora_ambito", "Finanças", "pt-PT"
    if n == "sns":
        return "fora_ambito", "SNS", "pt-PT"
    if n.startswith("vaga"):
        return "perguntar", None, "pt-PT"
    if "identificação" in n or "funcionário" in n:
        return "passar_humano", None, "pt-PT"
    if "legal entre particulares" in n or "jurídico" in n:
        return "passar_humano", None, "pt-PT"
    if n.startswith("política"):
        return "fora_ambito", None, "pt-PT"
    if n.startswith("emergência"):
        return "emergencia", "112", "pt-PT"
    if "inglês" in n:
        return "outra_lingua", None, "en"
    if "fora do âmbito" in n:
        return "fora_ambito", None, "pt-PT"
    raise SystemExit(f"Indicação desconhecida nas difíceis: {nota!r}")


def comportamento_normal(categoria: str) -> tuple[str, str | None]:
    if categoria == "Água e saneamento":
        # O próprio PDF: "Em Guimarães a água é gerida pela Vimágua".
        return "encaminhar", "Vimágua"
    if categoria == "Ocorrências na via pública":
        return "ocorrencia", None
    return "responder", None


def ler_linhas() -> list[str]:
    doc = fitz.open(PDF)
    linhas = []
    for pagina in doc:
        for linha in pagina.get_text().splitlines():
            linha = linha.replace("​", "").strip()
            if linha and not RUIDO.match(linha):
                linhas.append(linha)
    return linhas


def extrair() -> list[dict]:
    linhas = ler_linhas()
    perguntas: list[dict] = []
    categoria = None
    esperado = 0  # número esperado da próxima pergunta na categoria
    em_pergunta = False

    for linha in linhas:
        if linha in CATEGORIAS:
            categoria, esperado, em_pergunta = linha, 1, False
            continue
        if categoria is None:
            continue  # introdução do documento
        m = NUMERADA.match(linha)
        if m and int(m.group(1)) == esperado:
            perguntas.append({"categoria": categoria, "texto": m.group(2)})
            esperado += 1
            em_pergunta = True
        elif em_pergunta:
            perguntas[-1]["texto"] += " " + linha  # pergunta partida em 2 linhas
        # Senão: parágrafo de introdução da categoria (água, difíceis).

    vistas = {p["categoria"] for p in perguntas}
    faltam = [c for c in CATEGORIAS if c not in vistas]
    if faltam:
        raise SystemExit(f"Categorias sem perguntas: {faltam}")

    saida = []
    for ordem, p in enumerate(perguntas, start=1):
        texto, nota, idioma = p["texto"], None, "pt-PT"
        if p["categoria"] == DIFICEIS:
            m = PARENTESES.match(texto)
            if not m:
                raise SystemExit(f"Difícil sem indicação: {texto!r}")
            texto, nota = m.group(1).strip(), m.group(2).strip()
            comportamento, entidade, idioma = comportamento_dificil(nota)
        else:
            comportamento, entidade = comportamento_normal(p["categoria"])
        saida.append(
            {
                "ordem": ordem,
                "categoria": p["categoria"],
                "texto": texto,
                "idioma": idioma,
                "comportamento": comportamento,
                "entidade_esperada": entidade,
                "nota": nota,
            }
        )
    return saida


def main() -> None:
    perguntas = extrair()
    SAIDA.write_text(
        json.dumps(perguntas, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    contagem: dict[str, int] = {}
    for p in perguntas:
        contagem[p["categoria"]] = contagem.get(p["categoria"], 0) + 1
    sys.stdout.reconfigure(encoding="utf-8")
    for c, n in contagem.items():
        print(f"{n:4d}  {c}")
    print(f"{len(perguntas):4d}  total -> {SAIDA.name}")


if __name__ == "__main__":
    main()

import 'package:flutter/material.dart';

import '../fila/fila_offline.dart';
import '../tema.dart';

/// Cartão arredondado (papel, linha creme), como o `Cartao` do painel.
class Cartao extends StatelessWidget {
  const Cartao({
    super.key,
    required this.child,
    this.onTap,
    this.padding,
    this.cor,
  });
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry? padding;
  final Color? cor;

  @override
  Widget build(BuildContext context) {
    final conteudo = Padding(
      padding: padding ?? const EdgeInsets.all(18),
      child: child,
    );
    return Card(
      color: cor,
      clipBehavior: Clip.antiAlias,
      child: onTap == null ? conteudo : InkWell(onTap: onTap, child: conteudo),
    );
  }
}

enum TomPilula { neutro, terracota, verde, ambar, tinta }

/// Etiqueta curta ("Por enviar", "Feita", "Atrasada").
class Pilula extends StatelessWidget {
  const Pilula(
    this.texto, {
    super.key,
    this.tom = TomPilula.neutro,
    this.icone,
  });
  final String texto;
  final TomPilula tom;
  final IconData? icone;

  @override
  Widget build(BuildContext context) {
    final (fundo, frente) = switch (tom) {
      TomPilula.neutro => (Cores.creme2, Cores.tinta),
      TomPilula.terracota => (Cores.terracotaSuave, Cores.terracotaEscuro),
      TomPilula.verde => (Cores.verdeSuave, Cores.verde),
      TomPilula.ambar => (Cores.ambarSuave, Cores.ambar),
      TomPilula.tinta => (Cores.tinta, Colors.white),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: fundo,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icone != null) ...[
            Icon(icone, size: 17, color: frente),
            const SizedBox(width: 5),
          ],
          Flexible(
            child: Text(
              texto,
              style: TextStyle(
                color: frente,
                fontWeight: FontWeight.w700,
                fontSize: 15,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Título de secção em maiúsculas pequenas.
class Rotulo extends StatelessWidget {
  const Rotulo(this.texto, {super.key});
  final String texto;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(
      texto.toUpperCase(),
      style: const TextStyle(
        fontSize: 14,
        letterSpacing: 0.8,
        fontWeight: FontWeight.w700,
        color: Cores.tinta2,
      ),
    ),
  );
}

/// Faixa "x por enviar" / "Sem rede" no topo dos ecrãs.
class IndicadorFila extends StatelessWidget {
  const IndicadorFila({super.key, required this.fila, this.aoAbrir});
  final FilaOffline fila;
  final VoidCallback? aoAbrir;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: fila,
      builder: (context, _) {
        final n = fila.porEnviar;
        if (n == 0 && fila.ultimaFalhaRede == null) {
          return const SizedBox.shrink();
        }
        final semRede = fila.ultimaFalhaRede != null;
        final texto = n == 0
            ? 'Sem ligação ao servidor'
            : n == 1
            ? '1 por enviar'
            : '$n por enviar';
        final detalhe = fila.aEnviar
            ? 'A enviar…'
            : semRede
            ? 'Sem rede: envia quando a rede voltar'
            : fila.falhadas > 0
            ? '${fila.falhadas} com problema: toque para ver'
            : 'Toque para ver';
        return Semantics(
          button: true,
          label: '$texto. $detalhe',
          child: Material(
            color: semRede ? Cores.ambarSuave : Cores.terracotaSuave,
            child: InkWell(
              onTap: aoAbrir,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: alvoPrincipal),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  child: Row(
                    children: [
                      Icon(
                        semRede
                            ? Icons.cloud_off_rounded
                            : Icons.cloud_upload_rounded,
                        color: semRede ? Cores.ambar : Cores.terracotaEscuro,
                        size: 28,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              texto,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 18,
                                color: Cores.tinta,
                              ),
                            ),
                            Text(
                              detalhe,
                              style: const TextStyle(
                                fontSize: 15,
                                color: Cores.tinta,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (fila.aEnviar)
                        const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 3),
                        )
                      else
                        const Icon(
                          Icons.chevron_right_rounded,
                          color: Cores.tinta,
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Mensagem de erro em linha, com "Tentar outra vez".
class ErroLinha extends StatelessWidget {
  const ErroLinha(this.mensagem, {super.key, this.aoTentar});
  final String mensagem;
  final VoidCallback? aoTentar;

  @override
  Widget build(BuildContext context) => Cartao(
    cor: const Color(0xFFFBE4DD),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(
              Icons.error_outline_rounded,
              color: Color(0xFFA1260F),
              size: 28,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                mensagem,
                style: Theme.of(context).textTheme.bodyLarge,
              ),
            ),
          ],
        ),
        if (aoTentar != null) ...[
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: aoTentar,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Tentar outra vez'),
          ),
        ],
      ],
    ),
  );
}

/// Linha "ícone + texto" para dados (morada, hora, referência).
class LinhaDado extends StatelessWidget {
  const LinhaDado(this.icone, this.texto, {super.key, this.forte = false});
  final IconData icone;
  final String texto;
  final bool forte;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icone, size: 24, color: Cores.tinta2),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            texto,
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
              fontWeight: forte ? FontWeight.w700 : FontWeight.w400,
            ),
          ),
        ),
      ],
    ),
  );
}

void avisar(BuildContext context, String texto) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(texto)));
}

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../comum/api/cliente_api.dart';
import '../comum/componentes/componentes.dart';
import '../comum/datas.dart';
import '../comum/tema.dart';
import 'modelos.dart';
import 'repositorio.dart';

/// Ícone e cor de cada tipo do feed (os mesmos de `code/web/components/agora/tipos.ts`).
class EstiloTipo {
  const EstiloTipo(this.nome, this.singular, this.icone, this.cor);
  final String nome;
  final String singular;
  final IconData icone;
  final Color cor;
}

const estiloEmergencia = EstiloTipo(
  'Emergências',
  'Emergência',
  Icons.emergency_rounded,
  Color(0xFFA3101A),
);

const estilosTipo = {
  TipoItem.obras: EstiloTipo(
    'Obras e cortes',
    'Obra',
    Icons.construction_rounded,
    Color(0xFF8A5A00),
  ),
  TipoItem.incidentes: EstiloTipo(
    'Incidentes',
    'Incidente',
    Icons.warning_amber_rounded,
    Color(0xFFB84A24),
  ),
  TipoItem.avisos: EstiloTipo(
    'Avisos',
    'Aviso',
    Icons.campaign_rounded,
    Color(0xFF15263B),
  ),
  TipoItem.eventos: EstiloTipo(
    'Eventos',
    'Evento',
    Icons.event_rounded,
    Color(0xFF3F6E4A),
  ),
  TipoItem.consultas: EstiloTipo(
    'Consultas públicas',
    'Consulta pública',
    Icons.forum_rounded,
    Color(0xFF3B4A8C),
  ),
};

EstiloTipo estiloDe(ItemAgora i) =>
    i.emergencia ? estiloEmergencia : estilosTipo[i.tipo]!;

/// O quadrado colorido com o ícone do tipo.
class MarcaTipo extends StatelessWidget {
  const MarcaTipo(this.estilo, {super.key, this.tamanho = 44});
  final EstiloTipo estilo;
  final double tamanho;
  @override
  Widget build(BuildContext context) => Container(
    width: tamanho,
    height: tamanho,
    decoration: BoxDecoration(
      color: estilo.cor,
      borderRadius: BorderRadius.circular(tamanho * 0.28),
    ),
    child: Icon(estilo.icone, color: Colors.white, size: tamanho * 0.58),
  );
}

/// Um item do feed na lista.
class CartaoItemAgora extends StatelessWidget {
  const CartaoItemAgora({super.key, required this.item, this.onTap});
  final ItemAgora item;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final e = estiloDe(item);
    final t = Theme.of(context).textTheme;
    final onde = item.onde;
    final distancia = item.distanciaM;
    return Semantics(
      button: onTap != null,
      label:
          '${e.singular}: ${item.titulo}. ${onde ?? ''}${distancia != null ? ', a ${_distancia(distancia)}' : ''}',
      excludeSemantics: true,
      child: Cartao(
        onTap: onTap,
        cor: item.emergencia ? const Color(0xFFFBE4DD) : null,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            MarcaTipo(e),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      Pilula(
                        item.etiqueta.isEmpty ? e.singular : item.etiqueta,
                        tom: item.emergencia
                            ? TomPilula.terracota
                            : TomPilula.neutro,
                      ),
                      if (item.novo())
                        const Pilula('Novo', tom: TomPilula.verde),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(item.titulo, style: t.titleMedium),
                  if (onde != null || distancia != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      [
                        ?onde,
                        if (distancia != null) 'a ${_distancia(distancia)}',
                      ].join(' · '),
                      style: t.bodyMedium?.copyWith(color: Cores.tinta2),
                    ),
                  ],
                ],
              ),
            ),
            if (onTap != null)
              const Padding(
                padding: EdgeInsets.only(left: 4, top: 10),
                child: Icon(Icons.chevron_right_rounded, color: Cores.tinta2),
              ),
          ],
        ),
      ),
    );
  }
}

String _distancia(double m) {
  if (m < 1000) return '${((m / 10).round() * 10).clamp(10, 999)} m';
  final km = m / 1000;
  return '${(km >= 10 ? km.round().toString() : km.toStringAsFixed(1)).replaceAll('.', ',')} km';
}

/// "Sem rede: mostra o que estava guardado (22/10 às 10:32)".
class AvisoGuardado extends StatelessWidget {
  const AvisoGuardado(this.em, {super.key});
  final DateTime em;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Pilula(
      'Sem rede: o que estava guardado (${quando(em)})',
      tom: TomPilula.ambar,
      icone: Icons.cloud_off_rounded,
    ),
  );
}

/// Mensagem para o ecrã a partir de um erro.
String mensagemDe(Object e) {
  if (e is SemRede) {
    return 'Sem ligação à internet. Tente outra vez quando tiver rede.';
  }
  if (e is ErroApi) return e.mensagem;
  return 'Aconteceu um erro inesperado. Tente outra vez.';
}

/// Carrega uma leitura da API com "a carregar", erro com "Tentar outra
/// vez", aviso de cópia guardada e puxar para atualizar.
class Carregar<T> extends StatefulWidget {
  const Carregar({
    super.key,
    required this.ler,
    required this.construir,
    this.vazio,
    this.eVazio,
  });
  final Future<Lido<T>> Function() ler;
  final Widget Function(BuildContext context, T valor) construir;
  final String? vazio;
  final bool Function(T valor)? eVazio;

  @override
  State<Carregar<T>> createState() => _CarregarState<T>();
}

class _CarregarState<T> extends State<Carregar<T>> {
  late Future<Lido<T>> _f = widget.ler();

  Future<void> _recarregar() async {
    final f = widget.ler();
    setState(() {
      _f = f;
    });
    try {
      await f;
    } on Object {
      // o FutureBuilder mostra o erro
    }
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Lido<T>>(
    future: _f,
    builder: (context, s) {
      if (s.connectionState != ConnectionState.done) {
        return const Center(
          child: Padding(
            padding: EdgeInsets.all(32),
            child: CircularProgressIndicator(semanticsLabel: 'A carregar'),
          ),
        );
      }
      if (s.hasError) {
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [ErroLinha(mensagemDe(s.error!), aoTentar: _recarregar)],
        );
      }
      final l = s.data!;
      final vazio = widget.eVazio?.call(l.valor) ?? false;
      return RefreshIndicator(
        onRefresh: _recarregar,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            if (l.daCache) AvisoGuardado(l.guardadoEm!),
            if (vazio)
              EstadoVazio(widget.vazio ?? 'Nada por aqui.')
            else
              widget.construir(context, l.valor),
          ],
        ),
      );
    },
  );
}

class EstadoVazio extends StatelessWidget {
  const EstadoVazio(this.texto, {super.key, this.icone = Icons.inbox_rounded});
  final String texto;
  final IconData icone;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 16),
    child: Column(
      children: [
        Icon(icone, size: 48, color: Cores.tinta3),
        const SizedBox(height: 12),
        Text(
          texto,
          textAlign: TextAlign.center,
          style: Theme.of(
            context,
          ).textTheme.bodyLarge?.copyWith(color: Cores.tinta2),
        ),
      ],
    ),
  );
}

/// Botão largo com ícone (os atalhos do início, as ações dos detalhes).
class BotaoLargo extends StatelessWidget {
  const BotaoLargo({
    super.key,
    required this.icone,
    required this.texto,
    required this.onPressed,
    this.contorno = false,
  });
  final IconData icone;
  final String texto;
  final VoidCallback? onPressed;
  final bool contorno;
  @override
  Widget build(BuildContext context) => SizedBox(
    width: double.infinity,
    child: contorno
        ? OutlinedButton.icon(
            onPressed: onPressed,
            icon: Icon(icone),
            label: Text(texto),
          )
        : FilledButton.icon(
            onPressed: onPressed,
            icon: Icon(icone),
            label: Text(texto),
          ),
  );
}

/// Abre uma página do site (ou outra app) fora da app.
Future<void> abrirFora(BuildContext context, String url) async {
  final u = Uri.tryParse(url);
  var ok = false;
  if (u != null) {
    try {
      ok = await launchUrl(u, mode: LaunchMode.externalApplication);
    } on Object {
      ok = false;
    }
  }
  if (!ok && context.mounted) avisar(context, 'Não foi possível abrir: $url');
}

/// "22 de outubro de 2026".
String diaLongo(String? isoOuNull) {
  if (isoOuNull == null) return '';
  final d = DateTime.tryParse(isoOuNull);
  if (d == null) return isoOuNull;
  const meses = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ];
  return '${d.day} de ${meses[d.month - 1]} de ${d.year}';
}

/// "22/10/2026 às 10:30".
String diaHora(DateTime? d) {
  if (d == null) return '';
  final l = d.toLocal();
  String dois(int n) => n.toString().padLeft(2, '0');
  return '${dois(l.day)}/${dois(l.month)}/${l.year} às ${hora(l)}';
}

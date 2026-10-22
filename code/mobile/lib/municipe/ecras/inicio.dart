import 'package:flutter/material.dart';

import '../../comum/componentes/componentes.dart';
import '../../comum/componentes/marca.dart';
import '../../comum/tema.dart';
import '../app_municipe.dart';
import '../componentes.dart';
import '../config.dart';
import '../modelos.dart';
import '../repositorio.dart';
import '../servicos.dart';
import 'chat.dart';
import 'perto.dart';
import 'reportar.dart';

/// Início: o que se passa perto (emergências no topo) e os atalhos grandes.
class EcraInicio extends StatefulWidget {
  const EcraInicio({super.key});

  @override
  State<EcraInicio> createState() => _EcraInicioState();
}

class _EcraInicioState extends State<EcraInicio> {
  Future<Lido<Feed>>? _feed;
  String? _nome;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_feed == null) _carregar();
  }

  void _carregar() {
    final s = FornecedorMunicipe.de(context);
    _nome = s.sessao.sessao?.nome;
    final f = s.repositorio.feed(limite: 20);
    setState(() {
      _feed = f;
    });
    s.repositorio.eu().then((e) {
      s.sessao.atualizarNome(e.valor.nome);
      if (mounted) setState(() => _nome = e.valor.nome);
    }, onError: (Object _) {});
  }

  Future<void> _ligar() async {
    final url = ConfigMunicipe.telefone.isNotEmpty
        ? 'tel:${ConfigMunicipe.telefone.replaceAll(' ', '')}'
        : '${ConfigMunicipe.webUrl}/ligar';
    await abrirFora(context, url);
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final primeiro = _nome?.split(' ').first;
    return Scaffold(
      appBar: AppBar(title: const Marca()),
      body: RefreshIndicator(
        onRefresh: () async {
          _carregar();
          await _feed;
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Semantics(
              header: true,
              child: Text(
                primeiro == null ? 'Olá!' : 'Olá, $primeiro!',
                style: t.headlineMedium,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Em que podemos ajudar?',
              style: t.bodyLarge?.copyWith(color: Cores.tinta2),
            ),
            const SizedBox(height: 16),
            FutureBuilder<Lido<Feed>>(
              future: _feed,
              builder: (context, s) {
                final urgentes =
                    s.data?.valor.itens.where((i) => i.emergencia).toList() ??
                    const <ItemAgora>[];
                return Column(
                  children: [
                    for (final i in urgentes) ...[
                      CartaoItemAgora(
                        item: i,
                        onTap: () => abrirItem(context, i),
                      ),
                      const SizedBox(height: 12),
                    ],
                  ],
                );
              },
            ),
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              // Com letra maior, os atalhos ficam mais altos.
              childAspectRatio:
                  (1.25 / MediaQuery.textScalerOf(context).scale(1)).clamp(
                    0.7,
                    1.25,
                  ),
              children: [
                _Atalho(
                  icone: Icons.chat_rounded,
                  texto: 'Falar com a câmara',
                  cor: Cores.terracota,
                  onTap: () => Navigator.of(
                    context,
                  ).push(MaterialPageRoute(builder: (_) => const EcraChat())),
                ),
                _Atalho(
                  icone: Icons.call_rounded,
                  texto: 'Ligar',
                  cor: Cores.tinta,
                  onTap: _ligar,
                ),
                _Atalho(
                  icone: Icons.report_problem_rounded,
                  texto: 'Reportar um problema',
                  cor: Cores.ambar,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const EcraReportar()),
                  ),
                ),
                _Atalho(
                  icone: Icons.folder_open_rounded,
                  texto: 'Os meus assuntos',
                  cor: Cores.verde,
                  onTap: () => irPara(context, Navegacao.assuntos),
                ),
              ],
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: Semantics(
                    header: true,
                    child: Text(
                      'O que se passa perto de si',
                      style: t.titleLarge,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            FutureBuilder<Lido<Feed>>(
              future: _feed,
              builder: (context, s) {
                if (s.connectionState != ConnectionState.done) {
                  return const Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: CircularProgressIndicator()),
                  );
                }
                if (s.hasError) {
                  return ErroLinha(mensagemDe(s.error!), aoTentar: _carregar);
                }
                final l = s.data!;
                final itens = l.valor.itens
                    .where((i) => !i.emergencia)
                    .take(3)
                    .toList();
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (l.daCache) AvisoGuardado(l.guardadoEm!),
                    if (itens.isEmpty)
                      const EstadoVazio(
                        'Nada de novo no concelho. Ainda bem!',
                        icone: Icons.check_circle_outline_rounded,
                      ),
                    for (final i in itens) ...[
                      CartaoItemAgora(
                        item: i,
                        onTap: () => abrirItem(context, i),
                      ),
                      const SizedBox(height: 10),
                    ],
                    const SizedBox(height: 4),
                    BotaoLargo(
                      icone: Icons.place_rounded,
                      texto: 'Ver tudo o que se passa',
                      contorno: true,
                      onPressed: () => irPara(context, Navegacao.perto),
                    ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _Atalho extends StatelessWidget {
  const _Atalho({
    required this.icone,
    required this.texto,
    required this.cor,
    required this.onTap,
  });
  final IconData icone;
  final String texto;
  final Color cor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: texto,
    excludeSemantics: true,
    child: Material(
      color: cor,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Icon(icone, color: Colors.white, size: 36),
              Text(
                texto,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 19,
                  fontWeight: FontWeight.w700,
                  height: 1.2,
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

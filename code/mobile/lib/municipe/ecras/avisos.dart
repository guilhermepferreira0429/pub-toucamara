import 'package:flutter/material.dart';

import '../../comum/componentes/componentes.dart';
import '../../comum/tema.dart';
import '../componentes.dart';
import '../modelos.dart';
import '../servicos.dart';
import 'perto.dart';

/// Os avisos e emergências que a câmara enviou à pessoa, e os avisos que
/// ela pediu ("Avisar-me").
class EcraAvisos extends StatefulWidget {
  const EcraAvisos({super.key});

  @override
  State<EcraAvisos> createState() => _EcraAvisosState();
}

class _EcraAvisosState extends State<EcraAvisos> {
  int _versao = 0;

  @override
  Widget build(BuildContext context) {
    final s = FornecedorMunicipe.de(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Avisos'),
        actions: [
          IconButton(
            tooltip: 'Os avisos que pedi',
            icon: const Icon(Icons.tune_rounded),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const EcraAvisosPedidos()),
            ),
          ),
        ],
      ),
      body: Carregar<List<Aviso>>(
        key: ValueKey(_versao),
        ler: s.repositorio.avisos,
        construir: (context, l) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (l.isEmpty)
              const EstadoVazio(
                'Ainda não recebeu avisos da câmara.',
                icone: Icons.notifications_none_rounded,
              ),
            for (final a in l) ...[_CartaoAviso(a), const SizedBox(height: 10)],
            const SizedBox(height: 8),
            BotaoLargo(
              icone: Icons.notifications_active_rounded,
              texto: 'Pedir avisos para onde estou',
              contorno: true,
              onPressed: () async {
                await pedirAvisos(context);
                if (mounted) setState(() => _versao++);
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _CartaoAviso extends StatelessWidget {
  const _CartaoAviso(this.a);
  final Aviso a;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final urgente = a.urgente && a.ativo;
    return Semantics(
      container: true,
      label: urgente ? 'Aviso urgente' : null,
      child: Cartao(
        cor: urgente ? const Color(0xFFFBE4DD) : null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  a.origem == 'emergencia'
                      ? Icons.emergency_rounded
                      : Icons.campaign_rounded,
                  color: urgente ? const Color(0xFFA3101A) : Cores.tinta,
                  size: 28,
                ),
                const SizedBox(width: 10),
                Expanded(child: Text(a.titulo, style: t.titleMedium)),
              ],
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                if (urgente) const Pilula('Urgente', tom: TomPilula.terracota),
                if (!a.ativo) const Pilula('Já terminou'),
                if (a.em != null) Pilula(diaHora(a.em)),
              ],
            ),
            const SizedBox(height: 8),
            Text(a.mensagem, style: t.bodyLarge),
            if (a.instrucoes != null) ...[
              const SizedBox(height: 8),
              Text('O que fazer', style: t.labelLarge),
              Text(a.instrucoes!, style: t.bodyLarge),
            ],
            if (a.zona.isNotEmpty) ...[
              const SizedBox(height: 6),
              LinhaDado(Icons.place_outlined, a.zona),
            ],
            if (a.link != null) ...[
              const SizedBox(height: 8),
              BotaoLargo(
                icone: Icons.open_in_new_rounded,
                texto: 'Saber mais',
                contorno: true,
                onPressed: () => abrirFora(context, a.link!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Os avisos que a pessoa pediu ("Avisar-me"), para os cancelar.
class EcraAvisosPedidos extends StatefulWidget {
  const EcraAvisosPedidos({super.key});

  @override
  State<EcraAvisosPedidos> createState() => _EcraAvisosPedidosState();
}

class _EcraAvisosPedidosState extends State<EcraAvisosPedidos> {
  Future<List<Subscricao>>? _f;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _f ??= FornecedorMunicipe.de(context).repositorio.subscricoes();
  }

  void _recarregar() => setState(
    () => _f = FornecedorMunicipe.de(context).repositorio.subscricoes(),
  );

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final s = FornecedorMunicipe.de(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Os avisos que pedi')),
      body: FutureBuilder<List<Subscricao>>(
        future: _f,
        builder: (context, snap) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'Avisamos quando aparecer algo novo nestes sítios.',
              style: t.bodyLarge?.copyWith(color: Cores.tinta2),
            ),
            const SizedBox(height: 12),
            if (snap.connectionState != ConnectionState.done)
              const Center(child: CircularProgressIndicator())
            else if (snap.hasError)
              ErroLinha(mensagemDe(snap.error!), aoTentar: _recarregar)
            else if (snap.data!.isEmpty)
              const EstadoVazio('Ainda não pediu avisos.')
            else
              for (final x in snap.data!) ...[
                Cartao(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      LinhaDado(Icons.place_outlined, x.zona, forte: true),
                      LinhaDado(
                        Icons.label_outline_rounded,
                        x.tipos.join(', '),
                      ),
                      const SizedBox(height: 8),
                      BotaoLargo(
                        icone: Icons.notifications_off_outlined,
                        texto: 'Deixar de avisar',
                        contorno: true,
                        onPressed: () async {
                          try {
                            await s.repositorio.cancelarSubscricao(x.id);
                            _recarregar();
                          } on Object catch (e) {
                            if (context.mounted) avisar(context, mensagemDe(e));
                          }
                        },
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
              ],
            const SizedBox(height: 8),
            BotaoLargo(
              icone: Icons.add_alert_rounded,
              texto: 'Pedir avisos para onde estou',
              onPressed: () async {
                await pedirAvisos(context);
                _recarregar();
              },
            ),
          ],
        ),
      ),
    );
  }
}

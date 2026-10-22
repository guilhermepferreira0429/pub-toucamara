import 'package:flutter/material.dart';

import '../../comum/api/cliente_api.dart';
import '../../comum/componentes/componentes.dart';
import '../../comum/datas.dart';
import '../../comum/tema.dart';
import '../servicos.dart';
import 'definicoes.dart';

/// Quem está a usar a app, os telemóveis com sessão aberta, o servidor e
/// sair.
class EcraSessao extends StatefulWidget {
  const EcraSessao({super.key});

  @override
  State<EcraSessao> createState() => _EcraSessaoState();
}

class _EcraSessaoState extends State<EcraSessao> {
  List<Map<String, dynamic>>? _sessoes;
  String? _erro;

  Future<void> _carregarSessoes() async {
    final api = FornecedorServicos.de(context).api;
    try {
      final r = await api.get('/painel/auth/app/sessoes') as Map;
      setState(() {
        _sessoes = (r['itens'] as List)
            .map((e) => (e as Map).cast<String, dynamic>())
            .toList();
        _erro = null;
      });
    } on ErroApi catch (e) {
      setState(() => _erro = e.mensagem);
    } on SemRede {
      setState(() => _erro = 'Sem rede: não dá para ver as sessões agora.');
    }
  }

  Future<void> _terminar(String id) async {
    final api = FornecedorServicos.de(context).api;
    try {
      await api.post('/painel/auth/app/sessoes/$id/revogar');
      await _carregarSessoes();
    } on Object catch (e) {
      if (mounted) avisar(context, 'Não foi possível terminar: $e');
    }
  }

  Future<void> _sair() async {
    final s = FornecedorServicos.de(context);
    final n = s.fila.porEnviar;
    final sim = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Sair da app?'),
        content: Text(n == 0
            ? 'Para voltar a entrar precisa de um código novo por email.'
            : 'Tem $n ${n == 1 ? 'ação' : 'ações'} por enviar. Ficam guardadas e são enviadas quando voltar a entrar neste telemóvel.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: const Text('Ficar')),
          FilledButton(
              onPressed: () => Navigator.pop(c, true),
              child: const Text('Sair')),
        ],
      ),
    );
    if (sim == true) await s.sessao.sair();
  }

  @override
  Widget build(BuildContext context) {
    final s = FornecedorServicos.de(context);
    final sessao = s.sessao.sessao;
    final texto = Theme.of(context).textTheme;
    if (sessao == null) return const SizedBox.shrink();
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      children: [
        Cartao(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(sessao.nome, style: texto.headlineSmall),
            const SizedBox(height: 6),
            LinhaDado(Icons.mail_outline_rounded, sessao.email),
            LinhaDado(Icons.badge_outlined, sessao.perfilLegivel),
            if (sessao.municipioNome != null)
              LinhaDado(Icons.location_city_rounded, sessao.municipioNome!),
            LinhaDado(Icons.lock_clock_outlined,
                'Sessão válida até ${quando(sessao.expiraEm)}'),
          ]),
        ),
        const SizedBox(height: 16),
        const Rotulo('Telemóveis com sessão aberta'),
        if (_sessoes == null && _erro == null)
          OutlinedButton.icon(
            onPressed: _carregarSessoes,
            icon: const Icon(Icons.devices_rounded),
            label: const Text('Ver as minhas sessões'),
          ),
        if (_erro != null) ErroLinha(_erro!, aoTentar: _carregarSessoes),
        if (_sessoes != null)
          for (final x in _sessoes!) ...[
            Cartao(
              child: Row(children: [
                const Icon(Icons.smartphone_rounded, size: 30),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${x['dispositivo'] ?? 'Telemóvel'}',
                            style: texto.titleMedium),
                        Text(
                            'Entrou ${quando(DateTime.parse(x['criada_em'] as String))}',
                            style: texto.bodySmall),
                      ]),
                ),
                if (x['esta'] == true)
                  const Pilula('Este', tom: TomPilula.verde)
                else
                  TextButton(
                      onPressed: () => _terminar(x['id'] as String),
                      child: const Text('Terminar')),
              ]),
            ),
            const SizedBox(height: 10),
          ],
        const SizedBox(height: 16),
        ListTile(
          contentPadding: EdgeInsets.zero,
          minTileHeight: alvoPrincipal,
          leading: const Icon(Icons.dns_outlined, size: 28),
          title: const Text('Servidor'),
          subtitle: Text(s.definicoes.servidor),
          trailing: const Icon(Icons.chevron_right_rounded),
          onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const EcraDefinicoes())),
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          style: FilledButton.styleFrom(backgroundColor: Cores.tinta),
          onPressed: _sair,
          icon: const Icon(Icons.logout_rounded),
          label: const Text('Sair'),
        ),
      ],
    );
  }
}

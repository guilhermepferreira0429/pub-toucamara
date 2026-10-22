import 'package:flutter/material.dart';

import '../../comum/componentes/componentes.dart';
import '../../comum/fila/fila_offline.dart';
import '../../comum/tema.dart';
import '../componentes.dart';
import '../modelos.dart';
import '../servicos.dart';
import 'servidor.dart';

/// Definições: notificações, tamanho da letra, quem está, por enviar, sair.
class EcraDefinicoes extends StatefulWidget {
  const EcraDefinicoes({super.key});

  @override
  State<EcraDefinicoes> createState() => _EcraDefinicoesState();
}

class _EcraDefinicoesState extends State<EcraDefinicoes> {
  Eu? _eu;
  String? _erro;
  bool _aGuardar = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_eu == null && _erro == null) _carregar();
  }

  Future<void> _carregar() async {
    try {
      final e = await FornecedorMunicipe.de(context).repositorio.eu();
      if (mounted) setState(() => _eu = e.valor);
    } on Object catch (e) {
      if (mounted) setState(() => _erro = mensagemDe(e));
    }
  }

  Future<void> _mudar({bool? avisos, bool? processos}) async {
    final s = FornecedorMunicipe.de(context);
    final antes = _eu;
    if (antes == null) return;
    setState(() {
      _aGuardar = true;
      _eu = Eu(
        nome: antes.nome,
        telefone: antes.telefone,
        avisos: avisos ?? antes.avisos,
        processos: processos ?? antes.processos,
        zona: antes.zona,
      );
    });
    try {
      await s.repositorio.guardarPreferencias(
        avisos: avisos,
        processos: processos,
      );
    } on Object catch (e) {
      if (mounted) {
        setState(() => _eu = antes);
        avisar(context, mensagemDe(e));
      }
    } finally {
      if (mounted) setState(() => _aGuardar = false);
    }
  }

  Future<void> _sair() async {
    final s = FornecedorMunicipe.de(context);
    final pendentes = s.fila.porEnviar;
    final sim = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Sair da app?'),
        content: Text(
          pendentes > 0
              ? 'Tem $pendentes coisa(s) por enviar. Ficam guardadas e seguem quando voltar a entrar com este número.'
              : 'Para voltar a entrar pedimos outra vez um código por SMS.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(c).pop(false),
            child: const Text('Ficar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(c).pop(true),
            child: const Text('Sair'),
          ),
        ],
      ),
    );
    if (sim == true) await s.sessao.sair();
  }

  @override
  Widget build(BuildContext context) {
    final s = FornecedorMunicipe.de(context);
    final t = Theme.of(context).textTheme;
    final sessao = s.sessao.sessao;
    return Scaffold(
      appBar: AppBar(title: const Text('Definições')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Cartao(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Rotulo('A sua conta'),
                if ((_eu?.nome ?? sessao?.nome) != null)
                  LinhaDado(
                    Icons.person_outline_rounded,
                    (_eu?.nome ?? sessao?.nome)!,
                    forte: true,
                  ),
                LinhaDado(
                  Icons.phone_android_rounded,
                  _eu?.telefone ?? sessao?.telefone ?? '',
                ),
                LinhaDado(
                  Icons.location_city_rounded,
                  'Câmara: ${sessao?.municipioNome ?? s.municipio}',
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Cartao(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Rotulo('Notificações'),
                ListenableBuilder(
                  listenable: s.notificacoes,
                  builder: (context, _) => Pilula(
                    s.notificacoes.estado,
                    tom: s.notificacoes.configuradas
                        ? TomPilula.verde
                        : TomPilula.ambar,
                    icone: s.notificacoes.configuradas
                        ? Icons.notifications_active_rounded
                        : Icons.notifications_off_outlined,
                  ),
                ),
                const SizedBox(height: 8),
                if (_erro != null)
                  ErroLinha(
                    _erro!,
                    aoTentar: () {
                      setState(() => _erro = null);
                      _carregar();
                    },
                  )
                else if (_eu == null)
                  const Padding(
                    padding: EdgeInsets.all(12),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else ...[
                  const SwitchListTile(
                    value: true,
                    onChanged: null,
                    contentPadding: EdgeInsets.zero,
                    title: Text('Emergências'),
                    subtitle: Text('Sempre ligadas: são para a sua segurança.'),
                  ),
                  SwitchListTile(
                    value: _eu!.avisos,
                    onChanged: _aGuardar ? null : (v) => _mudar(avisos: v),
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Avisos da câmara'),
                    subtitle: const Text(
                      'Obras, cortes e avisos para a sua zona.',
                    ),
                  ),
                  SwitchListTile(
                    value: _eu!.processos,
                    onChanged: _aGuardar ? null : (v) => _mudar(processos: v),
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Os meus processos'),
                    subtitle: const Text(
                      'Quando um pedido seu avança ou falta alguma coisa.',
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 16),
          Cartao(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Rotulo('Tamanho da letra'),
                ListenableBuilder(
                  listenable: s.letra,
                  builder: (context, _) => SegmentedButton<double>(
                    segments: [
                      for (final (i, e) in Letra.opcoes.indexed)
                        ButtonSegment(
                          value: e,
                          tooltip: const [
                            'Normal',
                            'Grande',
                            'Maior',
                            'Muito grande',
                          ][i],
                          label: Text(
                            'A',
                            semanticsLabel: const [
                              'Normal',
                              'Grande',
                              'Maior',
                              'Muito grande',
                            ][i],
                            style: TextStyle(
                              fontSize: 14 + i * 4.0,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                    ],
                    selected: {s.letra.escala},
                    showSelectedIcon: false,
                    onSelectionChanged: (v) => s.letra.mudar(v.first),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Soma-se ao tamanho escolhido no telemóvel.',
                  style: t.bodySmall?.copyWith(color: Cores.tinta2),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          ListenableBuilder(
            listenable: s.fila,
            builder: (context, _) => Cartao(
              onTap: () => Navigator.of(
                context,
              ).push(MaterialPageRoute(builder: (_) => const EcraPorEnviar())),
              child: Row(
                children: [
                  const Icon(Icons.cloud_upload_outlined, size: 28),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      s.fila.porEnviar == 0
                          ? 'Nada por enviar'
                          : '${s.fila.porEnviar} por enviar',
                      style: t.titleMedium,
                    ),
                  ),
                  const Icon(Icons.chevron_right_rounded),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          BotaoLargo(
            icone: Icons.logout_rounded,
            texto: 'Sair',
            contorno: true,
            onPressed: _sair,
          ),
          const SizedBox(height: 16),
          Center(
            child: TextButton(
              onPressed: () => Navigator.of(
                context,
              ).push(MaterialPageRoute(builder: (_) => const EcraServidor())),
              child: Text(
                'Servidor (para testes)',
                style: t.bodySmall?.copyWith(color: Cores.tinta3),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// O que ficou no telemóvel à espera de rede.
class EcraPorEnviar extends StatelessWidget {
  const EcraPorEnviar({super.key});

  @override
  Widget build(BuildContext context) {
    final s = FornecedorMunicipe.de(context);
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Por enviar')),
      body: ListenableBuilder(
        listenable: s.fila,
        builder: (context, _) {
          final acoes = s.fila.acoes;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                'O que fez sem rede fica guardado e é enviado sozinho quando houver ligação.',
                style: t.bodyLarge?.copyWith(color: Cores.tinta2),
              ),
              const SizedBox(height: 12),
              if (acoes.isEmpty)
                const EstadoVazio(
                  'Está tudo enviado.',
                  icone: Icons.cloud_done_outlined,
                ),
              for (final a in acoes) ...[
                Cartao(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(a.descricao, style: t.titleMedium),
                      const SizedBox(height: 6),
                      Pilula(
                        a.estado == EstadoAcao.falhou
                            ? (a.ultimoErro ?? 'Não foi aceite')
                            : 'À espera de rede',
                        tom: a.estado == EstadoAcao.falhou
                            ? TomPilula.terracota
                            : TomPilula.ambar,
                      ),
                      if (a.estado == EstadoAcao.falhou) ...[
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () => s.fila.tentarDeNovo(a.id),
                                child: const Text('Tentar'),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () => s.fila.descartar(a.id),
                                child: const Text('Desistir'),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 10),
              ],
              if (acoes.isNotEmpty)
                BotaoLargo(
                  icone: Icons.send_rounded,
                  texto: s.fila.aEnviar ? 'A enviar…' : 'Enviar agora',
                  onPressed: s.fila.aEnviar ? null : s.fila.enviar,
                ),
            ],
          );
        },
      ),
    );
  }
}

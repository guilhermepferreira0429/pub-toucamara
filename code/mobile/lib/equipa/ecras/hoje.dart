import 'package:flutter/material.dart';

import '../../comum/api/cliente_api.dart';
import '../../comum/componentes/componentes.dart';
import '../../comum/datas.dart';
import '../../comum/localizacao/localizacao.dart';
import '../../comum/plataforma/navegar.dart';
import '../../comum/tema.dart';
import '../modelos.dart';
import '../servicos.dart';
import 'fila.dart';
import 'mapa.dart';
import 'ocorrencia.dart';
import 'sessao.dart';
import 'visita.dart';

/// A casa da app: Hoje (lista), Mapa, Por enviar e Sessão, em baixo para o
/// polegar.
class EcraHoje extends StatefulWidget {
  const EcraHoje({super.key, this.separadorInicial = 0});
  final int separadorInicial;

  @override
  State<EcraHoje> createState() => _EcraHojeState();
}

class _EcraHojeState extends State<EcraHoje> {
  late int _indice = widget.separadorInicial;
  // Os separadores só se constroem quando se abrem (o mapa pede mosaicos).
  late final Set<int> _vistos = {widget.separadorInicial};
  bool _aCarregar = false;
  String? _erro;
  bool _iniciado = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_iniciado) {
      _iniciado = true;
      _carregar();
    }
  }

  Future<void> _carregar() async {
    final repo = FornecedorServicos.de(context).repositorio;
    setState(() {
      _aCarregar = true;
      _erro = null;
    });
    try {
      await repo.carregarHoje();
    } on SemRede {
      _erro =
          'Sem rede e ainda sem tarefas guardadas neste telemóvel. Tente quando tiver rede.';
    } on ErroApi catch (e) {
      _erro = e.mensagem;
    } finally {
      if (mounted) setState(() => _aCarregar = false);
    }
  }

  void _ir(int i) => setState(() {
    _indice = i;
    _vistos.add(i);
  });

  static const _titulos = ['Hoje', 'Mapa', 'Por enviar', 'Sessão'];

  @override
  Widget build(BuildContext context) {
    final s = FornecedorServicos.de(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(_titulos[_indice]),
        actions: [
          if (_indice < 2)
            IconButton(
              tooltip: 'Atualizar',
              onPressed: _aCarregar ? null : _carregar,
              icon: const Icon(Icons.refresh_rounded, size: 28),
            ),
        ],
      ),
      body: Column(
        children: [
          if (_indice != 2) IndicadorFila(fila: s.fila, aoAbrir: () => _ir(2)),
          Expanded(
            child: IndexedStack(
              index: _indice,
              children: [
                _ListaHoje(
                  aCarregar: _aCarregar,
                  erro: _erro,
                  aoAtualizar: _carregar,
                ),
                if (_vistos.contains(1))
                  MapaTarefas(aCarregar: _aCarregar)
                else
                  const SizedBox.shrink(),
                if (_vistos.contains(2))
                  const EcraFila()
                else
                  const SizedBox.shrink(),
                if (_vistos.contains(3))
                  const EcraSessao()
                else
                  const SizedBox.shrink(),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: ListenableBuilder(
        listenable: s.fila,
        builder: (context, _) => NavigationBar(
          selectedIndex: _indice,
          onDestinationSelected: _ir,
          destinations: [
            const NavigationDestination(
              icon: Icon(Icons.checklist_rounded, size: 28),
              label: 'Hoje',
            ),
            const NavigationDestination(
              icon: Icon(Icons.map_outlined, size: 28),
              label: 'Mapa',
            ),
            NavigationDestination(
              icon: Badge(
                isLabelVisible: s.fila.porEnviar > 0,
                label: Text('${s.fila.porEnviar}'),
                child: const Icon(Icons.cloud_upload_outlined, size: 28),
              ),
              label: 'Por enviar',
            ),
            const NavigationDestination(
              icon: Icon(Icons.person_outline_rounded, size: 28),
              label: 'Sessão',
            ),
          ],
        ),
      ),
    );
  }
}

/// Abre a visita ou a ocorrência.
void abrirTarefa(BuildContext context, Tarefa t) {
  Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => t.tipo == TipoTarefa.visita
          ? EcraVisita(id: t.id, numero: t.numero)
          : EcraOcorrencia(id: t.id, numero: t.numero),
    ),
  );
}

class _ListaHoje extends StatelessWidget {
  const _ListaHoje({
    required this.aCarregar,
    required this.erro,
    required this.aoAtualizar,
  });
  final bool aCarregar;
  final String? erro;
  final Future<void> Function() aoAtualizar;

  /// As fechadas ou concluídas aqui (ainda por enviar) já não contam.
  static int _porFazer(Servicos s, DiaDeTrabalho dia) => dia.tarefas
      .where((t) => !t.feita && !s.repositorio.fechadaAqui(t.id))
      .length;

  @override
  Widget build(BuildContext context) {
    final s = FornecedorServicos.de(context);
    final texto = Theme.of(context).textTheme;
    return ListenableBuilder(
      listenable: Listenable.merge([s.repositorio, s.fila]),
      builder: (context, _) {
        final dia = s.repositorio.dia;
        return RefreshIndicator(
          onRefresh: aoAtualizar,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            children: [
              Text(
                diaPorExtenso(DateTime.now()),
                style: texto.titleMedium?.copyWith(color: Cores.tinta2),
              ),
              const SizedBox(height: 4),
              if (dia != null) ...[
                Text(switch (_porFazer(s, dia)) {
                  0 => 'Nada por fazer',
                  1 => '1 tarefa por fazer',
                  final n => '$n tarefas por fazer',
                }, style: texto.headlineSmall),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    if (dia.daCache)
                      Pilula(
                        'Sem rede · dados de ${quando(dia.obtidoEm)}',
                        tom: TomPilula.ambar,
                        icone: Icons.cloud_off_rounded,
                      )
                    else
                      Pilula(
                        'Atualizado ${quando(dia.obtidoEm)}',
                        icone: Icons.check_rounded,
                      ),
                    if (s.repositorio.ondeEstou == null)
                      const Pilula(
                        'Sem localização: ordem pelo número',
                        icone: Icons.location_disabled_rounded,
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 14),
              if (aCarregar && dia == null)
                const Padding(
                  padding: EdgeInsets.all(40),
                  child: Center(child: CircularProgressIndicator()),
                ),
              if (erro != null) ErroLinha(erro!, aoTentar: aoAtualizar),
              if (dia != null && dia.tarefas.isEmpty)
                Cartao(
                  child: Text(
                    !dia.mostraOcorrencias && !dia.mostraVisitas
                        ? 'O seu perfil não tem visitas de fiscalização nem ocorrências.'
                        : 'Não há visitas nem ocorrências para hoje.',
                    style: texto.bodyLarge,
                  ),
                ),
              if (dia != null)
                for (final t in dia.tarefas) ...[
                  CartaoTarefa(tarefa: t),
                  const SizedBox(height: 12),
                ],
            ],
          ),
        );
      },
    );
  }
}

/// Uma tarefa na lista: o que é, onde, a que distância, e "Navegar".
class CartaoTarefa extends StatelessWidget {
  const CartaoTarefa({super.key, required this.tarefa, this.compacto = false});
  final Tarefa tarefa;
  final bool compacto;

  @override
  Widget build(BuildContext context) {
    final s = FornecedorServicos.de(context);
    final t = tarefa;
    final texto = Theme.of(context).textTheme;
    final pendente = s.repositorio.pendenteDe(t.id);
    final visita = t.tipo == TipoTarefa.visita;
    return Semantics(
      button: true,
      label:
          '${visita ? 'Visita' : 'Ocorrência'} ${t.numero}, ${t.titulo}, ${t.morada}${t.distanciaM != null ? ', a ${distanciaLegivel(t.distanciaM)}' : ''}',
      child: Cartao(
        onTap: () => abrirTarefa(context, t),
        cor: t.feita ? Cores.creme2 : null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: visita ? Cores.tinta : Cores.terracota,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(
                    visita ? Icons.assignment_outlined : Icons.report_outlined,
                    color: Colors.white,
                    size: 28,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${visita ? 'Visita' : 'Ocorrência'} · ${t.numero}',
                        style: texto.bodySmall?.copyWith(
                          color: Cores.tinta2,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(t.titulo, style: texto.titleMedium),
                    ],
                  ),
                ),
                if (t.distanciaM != null)
                  Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: Text(
                      distanciaLegivel(t.distanciaM),
                      style: texto.titleLarge?.copyWith(
                        color: Cores.terracotaEscuro,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            LinhaDado(Icons.place_outlined, t.morada, forte: true),
            if (!compacto && t.resumo.isNotEmpty)
              Text(
                t.resumo,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: texto.bodyMedium?.copyWith(color: Cores.tinta2),
              ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                Pilula(
                  t.estadoNome,
                  tom: t.feita ? TomPilula.verde : TomPilula.neutro,
                ),
                if (t.janela != null)
                  Pilula(t.janela!, icone: Icons.schedule_rounded),
                if (t.atrasada && !t.feita)
                  Pilula(
                    visita
                        ? 'Era para ${diaCurto(t.dia ?? '')}'
                        : 'Prevista ${diaCurto(t.dia ?? '')}',
                    tom: TomPilula.ambar,
                  ),
                if (t.reportes > 1)
                  Pilula(
                    '${t.reportes} pessoas avisaram',
                    tom: TomPilula.terracota,
                  ),
                if (pendente != null)
                  Pilula(
                    pendente,
                    tom: TomPilula.tinta,
                    icone: Icons.cloud_upload_rounded,
                  ),
              ],
            ),
            if (!t.feita) ...[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () async {
                    final ok = await navegarPara(
                      lat: t.lat,
                      lng: t.lng,
                      morada: t.morada,
                    );
                    if (!ok && context.mounted) {
                      avisar(context, 'Não há app de mapas para abrir.');
                    }
                  },
                  icon: const Icon(Icons.navigation_rounded),
                  label: const Text('Navegar até lá'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

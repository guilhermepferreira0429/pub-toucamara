import 'package:flutter/material.dart';

import '../../comum/componentes/componentes.dart';
import '../../comum/tema.dart';
import '../chat.dart';
import '../componentes.dart';
import '../modelos.dart';
import '../servicos.dart';

/// Falar com a câmara: o assistente por escrito (ou ditado).
class EcraChat extends StatefulWidget {
  const EcraChat({super.key, this.controlador});

  /// Para os testes; normalmente cria um novo.
  final ControladorChat? controlador;

  @override
  State<EcraChat> createState() => _EcraChatState();
}

class _EcraChatState extends State<EcraChat> {
  ControladorChat? _c;
  final _texto = TextEditingController();
  final _rolar = ScrollController();
  bool _aOuvir = false;

  ControladorChat get c => _c!;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_c != null) return;
    _c = widget.controlador ?? FornecedorMunicipe.de(context).novoChat();
    c.addListener(_descer);
    c.iniciar();
  }

  @override
  void dispose() {
    c.removeListener(_descer);
    if (widget.controlador == null) c.dispose();
    _texto.dispose();
    _rolar.dispose();
    super.dispose();
  }

  void _descer() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_rolar.hasClients) {
        _rolar.animateTo(
          _rolar.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _enviar() async {
    final t = _texto.text.trim();
    if (t.isEmpty || c.ocupado) return;
    _texto.clear();
    await c.enviar(t);
  }

  Future<void> _ditar() async {
    final d = FornecedorMunicipe.de(context).ditado;
    if (_aOuvir) {
      await d.parar();
      setState(() => _aOuvir = false);
      return;
    }
    if (!await d.preparar()) {
      if (mounted) {
        avisar(
          context,
          'Este telemóvel não tem ditado por voz. Escreva, por favor.',
        );
      }
      return;
    }
    setState(() => _aOuvir = true);
    await d.comecar((texto, fim) {
      if (!mounted) return;
      _texto.text = texto;
      if (fim) {
        setState(() => _aOuvir = false);
        _enviar();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: ListenableBuilder(
          listenable: c,
          builder: (context, _) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Falar com a câmara'),
              if (c.agente != null)
                Text(
                  'Assistente ${c.agente}',
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: Cores.tinta2),
                ),
            ],
          ),
        ),
      ),
      body: ListenableBuilder(
        listenable: c,
        builder: (context, _) => Column(
          children: [
            if (c.ligacao == LigacaoChat.semLigacao)
              _Faixa(
                'Sem ligação. As mensagens ficam guardadas.',
                acao: 'Tentar',
                aoTocar: c.tentarDeNovo,
              ),
            if (c.ligacao == LigacaoChat.indisponivel)
              _Faixa(c.avisoGeral ?? 'O assistente não está disponível agora.'),
            Expanded(
              child: ListView(
                controller: _rolar,
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                children: [
                  if (c.ligacao == LigacaoChat.aIniciar && c.mensagens.isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(24),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                  for (final m in c.mensagens) _Balao(m, c: c),
                ],
              ),
            ),
            const Divider(height: 1),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    IconButton.filledTonal(
                      onPressed: _ditar,
                      tooltip: _aOuvir ? 'Parar de ditar' : 'Ditar por voz',
                      iconSize: 28,
                      icon: Icon(
                        _aOuvir ? Icons.stop_rounded : Icons.mic_rounded,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: _texto,
                        minLines: 1,
                        maxLines: 5,
                        textInputAction: TextInputAction.send,
                        onSubmitted: (_) => _enviar(),
                        style: const TextStyle(fontSize: 19),
                        textCapitalization: TextCapitalization.sentences,
                        decoration: InputDecoration(
                          hintText: _aOuvir
                              ? 'A ouvir…'
                              : 'Escreva a sua pergunta',
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 14,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      onPressed: c.ocupado ? null : _enviar,
                      tooltip: 'Enviar',
                      iconSize: 28,
                      icon: const Icon(Icons.send_rounded),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Faixa extends StatelessWidget {
  const _Faixa(this.texto, {this.acao, this.aoTocar});
  final String texto;
  final String? acao;
  final VoidCallback? aoTocar;

  @override
  Widget build(BuildContext context) => Material(
    color: Cores.ambarSuave,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        children: [
          const Icon(Icons.cloud_off_rounded, color: Cores.ambar),
          const SizedBox(width: 10),
          Expanded(child: Text(texto, style: const TextStyle(fontSize: 16))),
          if (acao != null) TextButton(onPressed: aoTocar, child: Text(acao!)),
        ],
      ),
    ),
  );
}

const _nomesFerramenta = {
  'procurar_conhecimento': 'A procurar a resposta…',
  'estado_processo': 'A ver os seus processos…',
  'registar_ocorrencia': 'A registar o problema…',
  'ver_vagas': 'A ver as vagas…',
  'marcar': 'A marcar…',
  'o_que_se_passa': 'A ver o que se passa…',
  'encaminhar': 'A procurar o contacto…',
};

class _Balao extends StatelessWidget {
  const _Balao(this.m, {required this.c});
  final MensagemChat m;
  final ControladorChat c;

  @override
  Widget build(BuildContext context) {
    final pessoa = m.papel == PapelChat.pessoa;
    final t = Theme.of(context).textTheme;
    final largura = MediaQuery.sizeOf(context).width * 0.86;
    return Align(
      alignment: pessoa ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: largura),
        child: Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Column(
            crossAxisAlignment: pessoa
                ? CrossAxisAlignment.end
                : CrossAxisAlignment.start,
            children: [
              if (m.texto.isNotEmpty || m.estado == EstadoMensagem.aResponder)
                Semantics(
                  label: '${pessoa ? 'Disse' : 'Resposta'}: ${m.texto}',
                  liveRegion: !pessoa && m.estado == EstadoMensagem.feita,
                  excludeSemantics: true,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 12,
                    ),
                    decoration: BoxDecoration(
                      color: pessoa ? Cores.tinta : Cores.papel,
                      border: pessoa
                          ? null
                          : Border.all(color: Cores.linha, width: 1.5),
                      borderRadius: BorderRadius.only(
                        topLeft: Radius.circular(pessoa ? 18 : 4),
                        topRight: Radius.circular(pessoa ? 4 : 18),
                        bottomLeft: const Radius.circular(18),
                        bottomRight: const Radius.circular(18),
                      ),
                    ),
                    child: m.texto.isEmpty
                        ? Text(
                            _nomesFerramenta[m.ferramenta] ??
                                (m.ferramenta != null
                                    ? 'A consultar…'
                                    : 'A escrever…'),
                            style: t.bodyLarge?.copyWith(
                              color: Cores.tinta2,
                              fontStyle: FontStyle.italic,
                            ),
                          )
                        : Text(
                            m.texto,
                            style: t.bodyLarge?.copyWith(
                              color: pessoa ? Colors.white : Cores.tinta,
                            ),
                          ),
                  ),
                ),
              for (final cartao in m.cartoes) ...[
                const SizedBox(height: 8),
                CartaoDoChat(cartao),
              ],
              if (m.estado == EstadoMensagem.porEnviar)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Pilula(
                    m.aviso ?? 'Por enviar (sem ligação)',
                    tom: TomPilula.ambar,
                    icone: Icons.schedule_rounded,
                  ),
                ),
              if (m.estado == EstadoMensagem.erro ||
                  m.estado == EstadoMensagem.interrompida)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Pilula(
                    m.aviso ?? 'A resposta ficou a meio.',
                    tom: TomPilula.ambar,
                    icone: Icons.warning_amber_rounded,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Os cartões principais (contacto, marcação, pagamento, ocorrência,
/// processo, o que se passa, fontes, 112) e um genérico para o resto.
class CartaoDoChat extends StatelessWidget {
  const CartaoDoChat(this.c, {super.key});
  final CartaoChat c;

  @override
  Widget build(BuildContext context) {
    final d = c.dados;
    return switch (c.tipo) {
      'emergencia' => const _Caixa(
        icone: Icons.emergency_rounded,
        cor: Color(0xFFA3101A),
        titulo: 'Emergência: ligue 112',
        linhas: ['Se há perigo para pessoas, ligue já para o 112.'],
        acao: ('Ligar 112', 'tel:112'),
      ),
      'fonte' => _Caixa(
        icone: Icons.menu_book_rounded,
        titulo: 'De onde vem esta resposta',
        linhas: [
          for (final f in listaDe(d['fontes']))
            [
              txt(f['titulo']),
              txt(f['referencia']),
            ].whereType<String>().join(' · '),
        ],
        acao: listaDe(d['fontes']).isEmpty
            ? null
            : ('Abrir a fonte', txt(listaDe(d['fontes']).first['url']) ?? ''),
      ),
      'contacto' => _contacto(d),
      'pagamento' => _Caixa(
        icone: Icons.payment_rounded,
        titulo: txt(d['metodo']) == 'mbway'
            ? 'Pagamento MB WAY'
            : 'Pagamento por Multibanco',
        linhas: [
          if (txt(d['entidade']) != null) 'Entidade: ${txt(d['entidade'])}',
          if (txt(d['referencia']) != null)
            'Referência: ${txt(d['referencia'])}',
          if (inteiro(d['valor_cent']) != null)
            'Valor: ${euros(inteiro(d['valor_cent'])!)}',
          if (txt(d['pagar_ate_dito']) != null)
            'Pagar até ${txt(d['pagar_ate_dito'])}',
          if (sim(d['modo_teste'])) 'Pagamento de teste',
        ],
        acao: txt(d['link']) == null ? null : ('Pagar', txt(d['link'])!),
      ),
      'ocorrencia' when sim(d['registada']) => _Caixa(
        icone: Icons.report_problem_rounded,
        titulo: sim(d['duplicada'])
            ? 'Já estava registada'
            : 'Problema registado',
        linhas: [
          if (txt(d['numero']) != null) 'N.º ${txt(d['numero'])}',
          ?txt(d['categoria']),
        ],
        acao: txt(d['link_foto']) == null
            ? null
            : ('Juntar fotografia', txt(d['link_foto'])!),
      ),
      'processo' when listaDe(d['processos']).isNotEmpty => _Caixa(
        icone: Icons.folder_rounded,
        titulo: 'Os seus processos',
        linhas: [
          for (final p in listaDe(d['processos']))
            [txt(p['numero']), txt(p['fase'])].whereType<String>().join(' · '),
        ],
      ),
      'marcacao' => _Caixa(
        icone: Icons.event_available_rounded,
        titulo: c.ferramenta == 'agendar_recolha'
            ? 'Recolha marcada'
            : 'Marcação',
        linhas: [
          ?txt(d['dizer']),
          ?txt(obj(d['marcacao'])['quando']),
          ?txt(obj(d['agenda'])['nome']),
          ?txt(d['local']),
        ],
        acao: txt(d['link']) == null
            ? null
            : ('Ver a marcação', txt(d['link'])!),
      ),
      'agora' => _Caixa(
        icone: Icons.place_rounded,
        titulo: c.ferramenta == 'avisar_me'
            ? 'Avisos combinados'
            : 'O que se passa perto',
        linhas: [
          for (final i in listaDe(d['itens']).take(4))
            ?(txt(i['frase']) ?? txt(i['titulo'])),
          if (c.ferramenta == 'avisar_me') ?txt(d['zona']),
        ],
        acao: txt(d['link']) == null ? null : ('Ver no site', txt(d['link'])!),
      ),
      _ => _generico(d),
    };
  }

  Widget _contacto(Json d) {
    final e = obj(d['entidade']);
    final contactos = [
      obj(d['contacto']),
      ...listaDe(d['outros_contactos']),
    ].where((x) => txt(x['valor']) != null).toList();
    final tel = contactos
        .where((x) => x['tipo'] == 'telefone' || x['tipo'] == 'avarias')
        .firstOrNull;
    return _Caixa(
      icone: Icons.contact_phone_rounded,
      titulo: txt(e['nome']) ?? 'Contacto',
      linhas: [
        for (final x in contactos)
          '${txt(x['rotulo']) ?? txt(x['tipo']) ?? ''}: ${txt(x['valor'])}',
      ],
      acao: tel == null
          ? null
          : ('Ligar', 'tel:${txt(tel['valor'])!.replaceAll(' ', '')}'),
    );
  }

  /// Os outros tipos: o que a ferramenta disser e o link, se houver.
  Widget _generico(Json d) {
    final linhas = [
      ?txt(d['dizer']),
      ?txt(d['mensagem']),
      if (txt(d['numero']) != null) 'N.º ${txt(d['numero'])}',
    ];
    final link = txt(d['link']);
    if (linhas.isEmpty && link == null) return const SizedBox.shrink();
    return _Caixa(
      icone: Icons.info_outline_rounded,
      titulo:
          const {
            'simulacao': 'Simulação',
            'rascunho': 'Rascunho',
            'requerimento': 'Pedido',
            'passagem': 'Falar com uma pessoa',
            'vagas': 'Vagas',
            'apoios': 'Apoios',
            'consulta': 'Consulta pública',
            'reclamacao': 'Reclamação',
            'empresa': 'Empresas',
            'entrega': 'Entrega',
            'documento': 'Documento',
            'termo': 'O que quer dizer',
          }[c.tipo] ??
          'Informação',
      linhas: linhas,
      acao: link == null ? null : ('Abrir', link),
    );
  }
}

class _Caixa extends StatelessWidget {
  const _Caixa({
    required this.icone,
    required this.titulo,
    this.linhas = const [],
    this.acao,
    this.cor,
  });
  final IconData icone;
  final String titulo;
  final List<String> linhas;
  final (String, String)? acao;
  final Color? cor;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Cartao(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icone, color: cor ?? Cores.terracotaEscuro, size: 26),
              const SizedBox(width: 10),
              Expanded(child: Text(titulo, style: t.titleMedium)),
            ],
          ),
          for (final l in linhas.where((x) => x.trim().isNotEmpty))
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(l, style: t.bodyLarge),
            ),
          if (acao != null && acao!.$2.isNotEmpty) ...[
            const SizedBox(height: 10),
            BotaoLargo(
              icone: Icons.open_in_new_rounded,
              texto: acao!.$1,
              contorno: true,
              onPressed: () => abrirFora(context, acao!.$2),
            ),
          ],
        ],
      ),
    );
  }
}

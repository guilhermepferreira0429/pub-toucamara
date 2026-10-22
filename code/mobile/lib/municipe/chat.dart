import 'package:flutter/foundation.dart';

import '../comum/api/cliente_api.dart';
import 'modelos.dart';
import 'repositorio.dart';

/// Um cartão do chat: o resultado de uma ferramenta (`event: cartao`), como
/// no `/chat` do site (`code/web/components/chat/cartoes.tsx`).
class CartaoChat {
  const CartaoChat({
    required this.tipo,
    this.ferramenta,
    this.dados = const {},
  });
  final String tipo;
  final String? ferramenta;
  final Json dados;

  factory CartaoChat.deJson(Json j) {
    // As fontes vêm à parte (`fontes`), o resto em `dados`.
    final dados = j['fontes'] is List
        ? {'fontes': j['fontes']}
        : obj(j['dados']);
    return CartaoChat(
      tipo: txt(j['tipo']) ?? 'desconhecido',
      ferramenta: txt(j['ferramenta']),
      dados: dados,
    );
  }
}

enum PapelChat { pessoa, agente }

enum EstadoMensagem {
  enviada,
  porEnviar,
  aResponder,
  feita,
  interrompida,
  erro,
}

class MensagemChat {
  MensagemChat({
    required this.id,
    required this.papel,
    this.texto = '',
    List<CartaoChat>? cartoes,
    this.estado = EstadoMensagem.feita,
    this.ferramenta,
    this.aviso,
  }) : cartoes = cartoes ?? [];
  final String id;
  final PapelChat papel;
  String texto;
  final List<CartaoChat> cartoes;
  EstadoMensagem estado;

  /// A ferramenta a correr ("A consultar…").
  String? ferramenta;
  String? aviso;
}

enum LigacaoChat { aIniciar, pronto, semLigacao, indisponivel }

/// A conversa com o assistente: sessão de chat já identificada com a
/// pessoa (`POST /v1/app/chat/sessoes`) e as respostas em SSE
/// (`/v1/chat/sessoes/:sessao/mensagens`).
class ControladorChat extends ChangeNotifier {
  ControladorChat({required this.repositorio, required this.api});
  final RepositorioMunicipe repositorio;
  final ClienteApi api;

  final List<MensagemChat> mensagens = [];
  LigacaoChat ligacao = LigacaoChat.aIniciar;
  String? avisoGeral;
  String? agente;
  bool ocupado = false;
  String? _sessao;
  int _n = 0;
  bool _fechado = false;

  String _id() => 'm${DateTime.now().microsecondsSinceEpoch}${_n++}';

  void _mudou() {
    if (!_fechado) notifyListeners();
  }

  @override
  void dispose() {
    _fechado = true;
    super.dispose();
  }

  Future<String?> iniciar() async {
    if (_sessao != null) return _sessao;
    ligacao = LigacaoChat.aIniciar;
    _mudou();
    try {
      final r = await repositorio.novaSessaoChat();
      _sessao = txt(r['sessao']);
      agente = txt(r['agente']);
      ligacao = LigacaoChat.pronto;
      avisoGeral = null;
      final saudacao = txt(r['saudacao']);
      if (saudacao != null && !mensagens.any((m) => m.id == 'saudacao')) {
        mensagens.insert(
          0,
          MensagemChat(
            id: 'saudacao',
            papel: PapelChat.agente,
            texto: saudacao,
          ),
        );
      }
    } on SemRede {
      ligacao = LigacaoChat.semLigacao;
    } on ErroApi catch (e) {
      ligacao = LigacaoChat.indisponivel;
      avisoGeral = e.mensagem;
    }
    _mudou();
    return _sessao;
  }

  /// Envia [texto] (ou repete a mensagem [reenviar] que ficou por enviar).
  Future<bool> enviar(String texto, {MensagemChat? reenviar}) async {
    final t = texto.trim();
    if (t.isEmpty || ocupado) return false;
    ocupado = true;
    final pessoa =
        reenviar ?? MensagemChat(id: _id(), papel: PapelChat.pessoa, texto: t);
    pessoa
      ..estado = EstadoMensagem.enviada
      ..aviso = null;
    if (reenviar == null) mensagens.add(pessoa);
    _mudou();
    final resposta = MensagemChat(
      id: _id(),
      papel: PapelChat.agente,
      estado: EstadoMensagem.aResponder,
    );
    var recebeu = false;

    Future<void> correr(String sessao) async {
      await for (final ev in api.sse(
        '/chat/sessoes/${Uri.encodeComponent(sessao)}/mensagens',
        corpo: {'texto': t.length > 2000 ? t.substring(0, 2000) : t},
      )) {
        final d = obj(ev.dados);
        switch (ev.evento) {
          case 'texto':
            recebeu = true;
            resposta
              ..texto += '${d['texto'] ?? ''}'
              ..ferramenta = null;
          case 'ferramenta':
            recebeu = true;
            resposta.ferramenta = txt(d['nome']);
          case 'cartao':
            recebeu = true;
            resposta.cartoes.add(CartaoChat.deJson(d));
          case 'fim':
            resposta
              ..estado = EstadoMensagem.feita
              ..ferramenta = null;
          case 'erro':
            resposta
              ..estado = EstadoMensagem.erro
              ..ferramenta = null
              ..aviso =
                  txt(d['mensagem']) ??
                  'Não consegui responder. Tente outra vez.';
        }
        _mudou();
      }
    }

    try {
      var sessao = _sessao ?? await iniciar();
      if (sessao == null) {
        pessoa.estado = EstadoMensagem.porEnviar;
        return false;
      }
      mensagens.add(resposta);
      _mudou();
      try {
        await correr(sessao);
      } on ErroApi catch (e) {
        if (e.codigo != 'sessao_expirada' &&
            e.codigo != 'sessao_desconhecida') {
          rethrow;
        }
        _sessao = null;
        sessao = await iniciar();
        if (sessao == null) throw SemRede('Sem ligação.');
        await correr(sessao);
      }
      if (resposta.estado == EstadoMensagem.aResponder) {
        resposta
          ..estado = resposta.texto.isEmpty
              ? EstadoMensagem.interrompida
              : EstadoMensagem.feita
          ..ferramenta = null;
      }
      ligacao = LigacaoChat.pronto;
      return true;
    } on ErroApi catch (e) {
      mensagens.remove(resposta);
      pessoa
        ..estado = EstadoMensagem.porEnviar
        ..aviso = e.mensagem;
      return false;
    } on SemRede {
      if (recebeu) {
        resposta
          ..estado = EstadoMensagem.interrompida
          ..ferramenta = null;
      } else {
        mensagens.remove(resposta);
        pessoa.estado = EstadoMensagem.porEnviar;
      }
      ligacao = LigacaoChat.semLigacao;
      return false;
    } finally {
      ocupado = false;
      _mudou();
    }
  }

  /// Volta a enviar o que ficou por enviar.
  Future<void> tentarDeNovo() async {
    if (_sessao == null && await iniciar() == null) return;
    for (final m in [...mensagens]) {
      if (m.papel == PapelChat.pessoa && m.estado == EstadoMensagem.porEnviar) {
        if (!await enviar(m.texto, reenviar: m)) return;
      }
    }
  }
}

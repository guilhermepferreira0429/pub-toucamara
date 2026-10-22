import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../comum/api/cliente_api.dart';
import '../comum/armazenamento/armazem.dart';
import '../comum/sessao/sessao.dart' show EstadoSessao, ControladorSessao;

export '../comum/sessao/sessao.dart' show EstadoSessao;

/// Quem está na app: o munícipe do telemóvel confirmado por SMS.
class SessaoMunicipe {
  const SessaoMunicipe({
    required this.token,
    required this.sessaoId,
    required this.telefone,
    required this.municipioSlug,
    required this.municipioNome,
    this.nome,
  });

  /// `tca_…` (a API guarda só o hash; aqui fica no armazenamento cifrado).
  final String token;
  final String sessaoId;

  /// Mascarado pela API ("+351 9•• ••• 123").
  final String telefone;
  final String? nome;
  final String municipioSlug;
  final String municipioNome;

  /// A resposta de `POST /v1/public/app/entrar`.
  factory SessaoMunicipe.daResposta(Map<String, dynamic> j) {
    final m = (j['municipe'] as Map?)?.cast<String, dynamic>() ?? const {};
    final mu = (j['municipio'] as Map).cast<String, dynamic>();
    return SessaoMunicipe(
      token: j['token'] as String,
      sessaoId: j['sessao_id'] as String,
      telefone: '${m['telefone'] ?? ''}',
      nome: m['nome'] as String?,
      municipioSlug: mu['slug'] as String,
      municipioNome: mu['nome'] as String,
    );
  }

  Map<String, dynamic> paraJson() => {
    'token': token,
    'sessao_id': sessaoId,
    'municipe': {'telefone': telefone, 'nome': nome},
    'municipio': {'slug': municipioSlug, 'nome': municipioNome},
  };
}

/// Entrar com o telemóvel (código por SMS), manter a sessão e sair.
class ControladorSessaoMunicipe extends ChangeNotifier {
  ControladorSessaoMunicipe({
    required this.api,
    required Armazem armazemSeguro,
    required this.municipio,
  }) : _armazem = armazemSeguro {
    api.aoSessaoInvalida = () {
      _terminarLocal(motivo: 'A sessão terminou. Entre outra vez.');
    };
  }

  static const chave = 'sessao_municipe_v1';
  final ClienteApi api;
  final Armazem _armazem;

  /// O slug do município da app.
  String Function() municipio;

  EstadoSessao estado = EstadoSessao.aCarregar;
  SessaoMunicipe? sessao;
  String? aviso;

  /// Chamado ao sair (antes de apagar a sessão): desregistar o push.
  Future<void> Function()? antesDeSair;

  Future<void> carregar() async {
    final t = await _armazem.ler(chave);
    SessaoMunicipe? s;
    if (t != null) {
      try {
        s = SessaoMunicipe.daResposta(jsonDecode(t) as Map<String, dynamic>);
      } on Object {
        s = null;
      }
    }
    if (s != null) {
      _aplicar(s);
    } else {
      estado = EstadoSessao.fora;
      notifyListeners();
    }
  }

  void _aplicar(SessaoMunicipe s) {
    sessao = s;
    api.token = s.token;
    estado = EstadoSessao.dentro;
    aviso = null;
    notifyListeners();
  }

  /// Só os algarismos, com o indicativo se vier ("+351 912 345 678").
  static String limparTelefone(String t) {
    final mais = t.trim().startsWith('+') ? '+' : '';
    return mais + t.replaceAll(RegExp(r'\D'), '');
  }

  /// Um telemóvel português (9 algarismos começados por 9) ou com indicativo.
  static bool telefoneValido(String t) {
    final l = limparTelefone(t);
    if (l.startsWith('+')) return l.length >= 9 && l.length <= 16;
    if (l.startsWith('00')) return l.length >= 10 && l.length <= 17;
    return RegExp(r'^9\d{8}$').hasMatch(l);
  }

  /// Pede o código por SMS. Devolve o número mascarado.
  Future<String> pedirCodigo(String telefone) async {
    final r =
        await api.post(
              '/public/app/codigo',
              corpo: {
                'municipio': municipio(),
                'telefone': limparTelefone(telefone),
              },
            )
            as Map?;
    return '${r?['telefone'] ?? telefone}';
  }

  Future<void> entrar(String telefone, String codigo) async {
    final r =
        await api.post(
              '/public/app/entrar',
              corpo: {
                'municipio': municipio(),
                'telefone': limparTelefone(telefone),
                'codigo': codigo.trim(),
                'dispositivo': ControladorSessao.dispositivoPorOmissao(),
              },
            )
            as Map;
    final s = SessaoMunicipe.daResposta(r.cast<String, dynamic>());
    await _armazem.escrever(chave, jsonEncode(s.paraJson()));
    _aplicar(s);
  }

  /// O nome que a API conhece (vem em `app/eu`).
  Future<void> atualizarNome(String? nome) async {
    final s = sessao;
    if (s == null || nome == s.nome) return;
    final n = SessaoMunicipe(
      token: s.token,
      sessaoId: s.sessaoId,
      telefone: s.telefone,
      nome: nome,
      municipioSlug: s.municipioSlug,
      municipioNome: s.municipioNome,
    );
    await _armazem.escrever(chave, jsonEncode(n.paraJson()));
    sessao = n;
    notifyListeners();
  }

  Future<void> sair() async {
    try {
      await antesDeSair?.call();
    } on Object catch (e) {
      debugPrint('Push por desregistar: $e');
    }
    try {
      if (api.token != null) await api.post('/app/sair');
    } on Object catch (e) {
      debugPrint('Sair sem confirmar na API: $e');
    }
    await _terminarLocal();
  }

  Future<void> _terminarLocal({String? motivo}) async {
    // Primeiro o ecrã (volta a "Entrar" logo), depois o armazenamento.
    api.token = null;
    sessao = null;
    estado = EstadoSessao.fora;
    aviso = motivo;
    notifyListeners();
    await _armazem.apagar(chave);
  }
}

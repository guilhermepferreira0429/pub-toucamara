import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../api/cliente_api.dart';
import '../armazenamento/armazem.dart';

/// Quem está na app (utilizador do painel com perfil de campo).
class Sessao {
  const Sessao({
    required this.token,
    required this.expiraEm,
    required this.sessaoId,
    required this.utilizadorId,
    required this.nome,
    required this.email,
    required this.perfil,
    this.servicoId,
    this.municipioSlug,
    this.municipioNome,
  });

  final String token;
  final DateTime expiraEm;
  final String sessaoId;
  final String utilizadorId;
  final String nome;
  final String email;
  final String perfil;
  final String? servicoId;
  final String? municipioSlug;
  final String? municipioNome;

  bool get expirada => DateTime.now().isAfter(expiraEm);

  /// A resposta de `POST /v1/painel/auth/app/entrar`.
  factory Sessao.daResposta(Map<String, dynamic> j) {
    final u = (j['utilizador'] as Map).cast<String, dynamic>();
    final m = (j['municipio'] as Map?)?.cast<String, dynamic>();
    return Sessao(
      token: j['token'] as String,
      expiraEm: DateTime.parse(j['expira_em'] as String),
      sessaoId: j['sessao_id'] as String,
      utilizadorId: u['id'] as String,
      nome: u['nome'] as String,
      email: u['email'] as String,
      perfil: u['perfil'] as String,
      servicoId: u['servicoId'] as String?,
      municipioSlug: m?['slug'] as String?,
      municipioNome: m?['nome'] as String?,
    );
  }

  Map<String, dynamic> paraJson() => {
        'token': token,
        'expira_em': expiraEm.toIso8601String(),
        'sessao_id': sessaoId,
        'utilizador': {
          'id': utilizadorId,
          'nome': nome,
          'email': email,
          'perfil': perfil,
          'servicoId': servicoId,
        },
        'municipio': municipioSlug == null
            ? null
            : {'slug': municipioSlug, 'nome': municipioNome},
      };

  String get perfilLegivel => const {
        'tecnico': 'Técnico / fiscal',
        'chefe_divisao': 'Chefe de divisão',
        'admin': 'Administração',
        'equipa_toucamara': 'Equipa Tou, Câmara?',
      }[perfil] ??
      perfil;
}

enum EstadoSessao { aCarregar, fora, dentro }

/// Entrar (email → código de 6 dígitos), manter a sessão e sair.
class ControladorSessao extends ChangeNotifier {
  ControladorSessao({required this.api, required Armazem armazemSeguro})
      : _armazem = armazemSeguro {
    api.aoSessaoInvalida = () {
      // A API recusou o token (revogado/expirado): volta a pedir o código.
      _terminarLocal(motivo: 'A sessão terminou. Entre outra vez.');
    };
  }

  static const _chave = 'sessao_equipa_v1';
  final ClienteApi api;
  final Armazem _armazem;

  EstadoSessao estado = EstadoSessao.aCarregar;
  Sessao? sessao;

  /// Porque é que saiu (sessão revogada noutro sítio, por exemplo).
  String? aviso;

  Future<void> carregar() async {
    final t = await _armazem.ler(_chave);
    Sessao? s;
    if (t != null) {
      try {
        final j = jsonDecode(t) as Map<String, dynamic>;
        s = Sessao.daResposta(j);
      } on Object {
        s = null;
      }
    }
    if (s != null && !s.expirada) {
      _aplicar(s);
    } else {
      estado = EstadoSessao.fora;
      notifyListeners();
    }
  }

  void _aplicar(Sessao s) {
    sessao = s;
    api.token = s.token;
    estado = EstadoSessao.dentro;
    aviso = null;
    notifyListeners();
  }

  /// Pede o código (a API responde igual exista ou não a conta).
  Future<int> pedirCodigo(String email) async {
    final r = await api.post('/painel/auth/app/codigo',
        corpo: {'email': email.trim().toLowerCase()});
    return ((r as Map?)?['validade_minutos'] as num?)?.toInt() ?? 10;
  }

  Future<void> entrar(String email, String codigo,
      {String? dispositivo}) async {
    final r = await api.post('/painel/auth/app/entrar', corpo: {
      'email': email.trim().toLowerCase(),
      'codigo': codigo.trim(),
      'dispositivo': dispositivo ?? dispositivoPorOmissao(),
    }) as Map;
    final s = Sessao.daResposta(r.cast<String, dynamic>());
    await _armazem.escrever(_chave, jsonEncode(s.paraJson()));
    _aplicar(s);
  }

  /// Termina a sessão na API (se houver rede) e no telemóvel.
  Future<void> sair() async {
    try {
      if (api.token != null) await api.post('/painel/auth/app/sair');
    } on Object catch (e) {
      debugPrint('Sair sem confirmar na API: $e');
    }
    await _terminarLocal();
  }

  Future<void> _terminarLocal({String? motivo}) async {
    await _armazem.apagar(_chave);
    api.token = null;
    sessao = null;
    estado = EstadoSessao.fora;
    aviso = motivo;
    notifyListeners();
  }

  static String dispositivoPorOmissao() {
    if (kIsWeb) return 'Navegador (web)';
    return defaultTargetPlatform == TargetPlatform.android
        ? 'Telemóvel Android'
        : 'Dispositivo';
  }
}

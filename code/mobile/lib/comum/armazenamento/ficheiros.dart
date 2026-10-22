import 'dart:convert';
import 'dart:typed_data';

import 'armazem.dart';
import 'ficheiros_io.dart' if (dart.library.js_interop) 'ficheiros_web.dart'
    as plataforma;

/// Onde ficam as fotografias à espera de rede (a fila guarda só a referência).
abstract class GuardaFicheiros {
  Future<String> guardar(String id, Uint8List bytes);
  Future<Uint8List?> ler(String ref);
  Future<void> apagar(String ref);

  /// Android: ficheiros na pasta privada da app. Web: no armazenamento local.
  static GuardaFicheiros daPlataforma(Armazem armazem) =>
      plataforma.criarGuardaFicheiros(armazem);
}

/// Em base64 num [Armazem] (web e testes). Chega para algumas fotografias
/// reduzidas (a app tira-as a ≤ 1600 px).
class GuardaFicheirosArmazem implements GuardaFicheiros {
  GuardaFicheirosArmazem(this._armazem);
  final Armazem _armazem;

  @override
  Future<String> guardar(String id, Uint8List bytes) async {
    final ref = 'ficheiro:$id';
    await _armazem.escrever(ref, base64Encode(bytes));
    return ref;
  }

  @override
  Future<Uint8List?> ler(String ref) async {
    final t = await _armazem.ler(ref);
    return t == null ? null : base64Decode(t);
  }

  @override
  Future<void> apagar(String ref) => _armazem.apagar(ref);
}

import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';

import 'armazem.dart';
import 'ficheiros.dart';

GuardaFicheiros criarGuardaFicheiros(Armazem armazem) => _GuardaFicheirosIo();

/// Ficheiros em `<documentos da app>/fila/`: sobrevivem a fechar a app.
class _GuardaFicheirosIo implements GuardaFicheiros {
  Future<Directory> _pasta() async {
    final base = await getApplicationDocumentsDirectory();
    final d = Directory('${base.path}/fila');
    if (!await d.exists()) await d.create(recursive: true);
    return d;
  }

  @override
  Future<String> guardar(String id, Uint8List bytes) async {
    final f = File('${(await _pasta()).path}/$id');
    await f.writeAsBytes(bytes, flush: true);
    return f.path;
  }

  @override
  Future<Uint8List?> ler(String ref) async {
    final f = File(ref);
    return await f.exists() ? f.readAsBytes() : null;
  }

  @override
  Future<void> apagar(String ref) async {
    final f = File(ref);
    if (await f.exists()) await f.delete();
  }
}

import 'dart:io';
import 'dart:typed_data';

import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

Future<bool> abrirPdf(Uint8List bytes, String nome) async {
  final dir = await getTemporaryDirectory();
  final seguro = nome.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
  final f = File('${dir.path}/$seguro');
  await f.writeAsBytes(bytes, flush: true);
  final r = await OpenFilex.open(f.path, type: 'application/pdf');
  return r.type == ResultType.done;
}

import 'dart:typed_data';

import 'abrir_pdf_io.dart'
    if (dart.library.js_interop) 'abrir_pdf_web.dart'
    as plataforma;

/// Abre um PDF (bytes vindos da API, com a sessão) no visualizador do
/// telemóvel (Android) ou num separador novo (web).
Future<bool> abrirPdf(Uint8List bytes, String nome) =>
    plataforma.abrirPdf(bytes, nome);

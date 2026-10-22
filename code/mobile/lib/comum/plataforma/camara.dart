import 'dart:typed_data';

import 'package:image_picker/image_picker.dart';

import '../localizacao/localizacao.dart';

/// Uma fotografia tirada no terreno, com onde e quando.
class FotoTirada {
  const FotoTirada({
    required this.bytes,
    required this.mime,
    required this.tiradaEm,
    this.local,
  });
  final Uint8List bytes;
  final String mime;
  final DateTime tiradaEm;
  final Ponto? local;

  /// O corpo do pedido à API (`esquemaFotoCampo`).
  Map<String, dynamic> corpo({String? legenda}) => {
    'mime': mime,
    if (legenda != null && legenda.trim().isNotEmpty) 'legenda': legenda.trim(),
    if (local != null) 'lat': local!.lat,
    if (local != null) 'lng': local!.lng,
    'tirada_em': tiradaEm.toUtc().toIso8601String(),
  };
}

abstract class Camara {
  Future<FotoTirada?> tirar({required bool daGaleria});
}

/// Câmara ou galeria (image_picker), reduzida a ≤ 1600 px para enviar com
/// pouca rede; o GPS é o do telemóvel no momento.
class CamaraSistema implements Camara {
  CamaraSistema(this.localizador);
  final Localizador localizador;
  final ImagePicker _picker = ImagePicker();

  @override
  Future<FotoTirada?> tirar({required bool daGaleria}) async {
    final f = await _picker.pickImage(
      source: daGaleria ? ImageSource.gallery : ImageSource.camera,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 75,
    );
    if (f == null) return null;
    final bytes = await f.readAsBytes();
    final local = await localizador.atual();
    return FotoTirada(
      bytes: bytes,
      mime: mimeDe(f.mimeType, f.name, bytes),
      tiradaEm: DateTime.now(),
      local: local,
    );
  }
}

/// O tipo pela assinatura dos bytes (o nome nem sempre traz extensão).
String mimeDe(String? declarado, String nome, Uint8List b) {
  if (b.length > 3 && b[0] == 0xFF && b[1] == 0xD8) return 'image/jpeg';
  if (b.length > 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E) {
    return 'image/png';
  }
  if (b.length > 12 &&
      String.fromCharCodes(b.sublist(0, 4)) == 'RIFF' &&
      String.fromCharCodes(b.sublist(8, 12)) == 'WEBP') {
    return 'image/webp';
  }
  if (declarado != null && declarado.startsWith('image/')) return declarado;
  final n = nome.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.heic')) return 'image/heic';
  return 'image/jpeg';
}

import 'dart:math' as math;

import 'package:geolocator/geolocator.dart';

/// Um ponto (graus decimais).
class Ponto {
  const Ponto(this.lat, this.lng);
  final double lat;
  final double lng;

  @override
  String toString() => '${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)}';
}

/// Distância em linha reta (haversine), em metros — a mesma conta da API
/// (`equipa-campo/regras.ts`).
double distanciaMetros(Ponto a, Ponto b) {
  const r = 6371000.0;
  double rad(double g) => g * math.pi / 180;
  final dLat = rad(b.lat - a.lat);
  final dLng = rad(b.lng - a.lng);
  final h =
      math.pow(math.sin(dLat / 2), 2) +
      math.cos(rad(a.lat)) *
          math.cos(rad(b.lat)) *
          math.pow(math.sin(dLng / 2), 2);
  return 2 * r * math.asin(math.min(1, math.sqrt(h)));
}

/// "350 m", "1,2 km".
String distanciaLegivel(double? m) {
  if (m == null) return '';
  if (m < 1000) {
    final arred = math.max(10, (m / 10).round() * 10);
    return '$arred m';
  }
  final km = (m / 1000);
  final texto = km >= 10 ? km.round().toString() : km.toStringAsFixed(1);
  return '${texto.replaceAll('.', ',')} km';
}

/// Onde está o telemóvel. Substituível nos testes.
abstract class Localizador {
  /// null sem permissão, sem GPS ou se demorar demasiado.
  Future<Ponto?> atual();
}

class LocalizadorGps implements Localizador {
  Ponto? _ultimo;

  @override
  Future<Ponto?> atual() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return _ultimo;
      var p = await Geolocator.checkPermission();
      if (p == LocationPermission.denied) {
        p = await Geolocator.requestPermission();
      }
      if (p == LocationPermission.denied ||
          p == LocationPermission.deniedForever) {
        return _ultimo;
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 12),
        ),
      );
      return _ultimo = Ponto(pos.latitude, pos.longitude);
    } on Object {
      return _ultimo;
    }
  }
}

class LocalizadorFixo implements Localizador {
  LocalizadorFixo(this.ponto);
  Ponto? ponto;
  @override
  Future<Ponto?> atual() async => ponto;
}

import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

/// Endereços para "navegar até lá". No Android, `geo:` abre a app de mapas
/// que a pessoa tiver (Google Maps, Waze, OsmAnd…); se não houver nenhuma,
/// o Google Maps na web.
List<Uri> enderecosNavegacao({
  double? lat,
  double? lng,
  required String morada,
}) {
  final temPonto = lat != null && lng != null;
  final destino = temPonto ? '$lat,$lng' : morada;
  final web = Uri.https('www.google.com', '/maps/dir/', {
    'api': '1',
    'destination': destino,
    'travelmode': 'driving',
  });
  if (kIsWeb) return [web];
  final rotulo = Uri.encodeComponent(morada);
  final geo = temPonto
      ? Uri.parse('geo:$lat,$lng?q=$lat,$lng($rotulo)')
      : Uri.parse('geo:0,0?q=$rotulo');
  return [geo, web];
}

Future<bool> navegarPara({
  double? lat,
  double? lng,
  required String morada,
}) async {
  for (final u in enderecosNavegacao(lat: lat, lng: lng, morada: morada)) {
    try {
      if (await launchUrl(u, mode: LaunchMode.externalApplication)) {
        return true;
      }
    } on Object {
      // tenta o seguinte
    }
  }
  return false;
}

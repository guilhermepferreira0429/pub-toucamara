import 'package:flutter/material.dart';

import 'municipe/app_municipe.dart';
import 'municipe/servicos.dart';

/// Flavor `municipe` ("Tou, Câmara"):
/// flutter run --flavor municipe -t lib/main_municipe.dart --dart-define=MUNICIPIO=guimaraes
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final servicos = await ServicosMunicipe.criar();
  runApp(AppMunicipe(servicos: servicos));
}

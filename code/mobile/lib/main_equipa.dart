import 'package:flutter/material.dart';

import 'equipa/app_equipa.dart';
import 'equipa/servicos.dart';

/// Flavor `equipa`: flutter run --flavor equipa -t lib/main_equipa.dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final servicos = await Servicos.criar();
  runApp(AppEquipa(servicos: servicos));
}

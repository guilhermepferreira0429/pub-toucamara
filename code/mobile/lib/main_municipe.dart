import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'comum/componentes/marca.dart';
import 'comum/tema.dart';

/// Flavor `municipe` ("Tou, Câmara"): a app do munícipe vem a seguir (a
/// API já existe: painel/app-municipe). Por agora, "em breve".
void main() => runApp(const AppMunicipe());

class AppMunicipe extends StatelessWidget {
  const AppMunicipe({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Tou, Câmara',
    debugShowCheckedModeBanner: false,
    theme: temaToucamara(),
    locale: const Locale('pt', 'PT'),
    supportedLocales: const [Locale('pt', 'PT')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    home: Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Marca(grande: true),
              const SizedBox(height: 24),
              Text(
                'Em breve',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 8),
              Text(
                'A app para os munícipes está a ser preparada. Até lá, ligue para a linha da câmara ou use o chat no site.',
                style: Theme.of(context).textTheme.bodyLarge,
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

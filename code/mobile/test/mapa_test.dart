import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:toucamara_app/comum/localizacao/localizacao.dart';
import 'package:toucamara_app/comum/mapa/config_mapa.dart';
import 'package:toucamara_app/comum/mapa/mapa_cidade.dart';

void main() {
  test('sem MAPBOX_TOKEN: OpenStreetMap em 2D, sem o mapa nativo', () {
    expect(ConfigMapa.token, isNull);
    expect(ConfigMapa.temMapbox, isFalse);
    expect(ConfigMapa.usarNativo, isFalse);
    expect(ConfigMapa.urlMosaicos, contains('tile.openstreetmap.org'));
    expect(ConfigMapa.tamanhoMosaico, 256);
    expect(ConfigMapa.creditos.single, contains('OpenStreetMap'));
    expect(ConfigMapa.estiloNativo, 'mapbox://styles/mapbox/standard');
  });

  testWidgets('marcadores com nome, toque e seleção; botão "onde estou"', (
    t,
  ) async {
    String? tocado;
    var localizar = 0;
    await t.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MapaCidade(
            rotulo: 'Mapa de teste',
            marcadores: const [
              MarcadorMapa(
                id: 'a',
                ponto: Ponto(41.4425, -8.2918),
                nome: 'Obra: Andaime',
                cor: Colors.brown,
                icone: Icons.construction_rounded,
                titulo: 'Andaime',
              ),
              MarcadorMapa(
                id: 'b',
                ponto: Ponto(41.4436, -8.2930),
                nome: 'Emergência: Rotura',
                cor: Colors.red,
                icone: Icons.emergency_rounded,
                titulo: 'Rotura',
                pulsar: true,
              ),
            ],
            enquadrar: const [Ponto(41.4425, -8.2918), Ponto(41.4436, -8.2930)],
            aoTocarMarcador: (id) => tocado = id,
            aoLocalizar: () => localizar++,
          ),
        ),
      ),
    );
    await t.pump(const Duration(milliseconds: 300));
    expect(find.bySemanticsLabel('Obra: Andaime'), findsOneWidget);
    expect(find.bySemanticsLabel('Emergência: Rotura'), findsOneWidget);
    await t.tap(find.text('Andaime'));
    expect(tocado, 'a');
    await t.tap(find.byTooltip('Mostrar onde estou'));
    expect(localizar, 1);
    // Sem token: os créditos do OpenStreetMap.
    expect(find.byType(MapaPlano), findsOneWidget);
  });

  testWidgets('chips em vidro: nome, contagem e estado', (t) async {
    var n = 0;
    await t.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChipVidro(
            nome: 'Eventos',
            ativo: true,
            contagem: 3,
            icone: Icons.event_rounded,
            aoTocar: () => n++,
          ),
        ),
      ),
    );
    expect(find.text('3'), findsOneWidget);
    await t.tap(find.text('Eventos'));
    expect(n, 1);
  });
}

import 'package:flutter/material.dart';

import '../tema.dart';

/// "Tou, Câmara?" com o sufixo da app ("Equipa").
class Marca extends StatelessWidget {
  const Marca({super.key, this.sufixo, this.grande = false});
  final String? sufixo;
  final bool grande;

  @override
  Widget build(BuildContext context) {
    final t = grande ? 34.0 : 22.0;
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Container(
        width: t * 1.5,
        height: t * 1.5,
        decoration: BoxDecoration(
          color: Cores.terracota,
          borderRadius: BorderRadius.circular(t * 0.45),
        ),
        alignment: Alignment.center,
        child: Text('T?',
            style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: t * 0.75)),
      ),
      SizedBox(width: t * 0.45),
      Flexible(
        child: Text.rich(
          TextSpan(children: [
            TextSpan(
                text: 'Tou, Câmara?',
                style: TextStyle(
                    fontSize: t, fontWeight: FontWeight.w700, color: Cores.tinta)),
            if (sufixo != null)
              TextSpan(
                  text: ' · $sufixo',
                  style: TextStyle(
                      fontSize: t,
                      fontWeight: FontWeight.w600,
                      color: Cores.terracotaEscuro)),
          ]),
        ),
      ),
    ]);
  }
}

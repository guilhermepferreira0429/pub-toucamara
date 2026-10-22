import 'package:flutter/material.dart';

import '../tema.dart';

/// O logótipo, como na web: "Tou, Câmara" com o "?" num balão de fala.
/// Com `sufixo`, o nome da app ("Equipa").
class Marca extends StatelessWidget {
  const Marca({super.key, this.sufixo, this.grande = false});
  final String? sufixo;
  final bool grande;

  @override
  Widget build(BuildContext context) {
    final t = grande ? 34.0 : 22.0;
    final nome = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Flexible(
          child: Text(
            'Tou, Câmara',
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: t,
              fontWeight: FontWeight.w700,
              color: Cores.tinta,
              height: 1.1,
              letterSpacing: t * -0.028,
            ),
          ),
        ),
        SizedBox(width: t * 0.12),
        Balao(lado: t * 1.07),
      ],
    );
    final sufixo = this.sufixo;
    return Semantics(
      label: sufixo == null ? 'Tou, Câmara?' : 'Tou, Câmara? $sufixo',
      excludeSemantics: true,
      child: sufixo == null
          ? nome
          : grande
              // Grande (ecrã de entrar): o nome da app por baixo.
              ? Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    nome,
                    SizedBox(height: t * 0.12),
                    Text(
                      sufixo,
                      style: TextStyle(
                        fontSize: t * 0.62,
                        fontWeight: FontWeight.w700,
                        color: Cores.terracotaEscuro,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ],
                )
              : Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(child: nome),
                    Text(
                      ' · $sufixo',
                      style: TextStyle(
                        fontSize: t,
                        fontWeight: FontWeight.w600,
                        color: Cores.terracotaEscuro,
                      ),
                    ),
                  ],
                ),
    );
  }
}

/// O balão terracota com o "?": redondo em três cantos, bico em baixo à
/// esquerda. É também o ícone da app e o favicon da web.
class Balao extends StatelessWidget {
  const Balao({super.key, required this.lado});
  final double lado;

  @override
  Widget build(BuildContext context) {
    final r = Radius.circular(lado / 2);
    return Container(
      width: lado,
      height: lado,
      decoration: BoxDecoration(
        color: Cores.terracota,
        borderRadius: BorderRadius.only(
          topLeft: r,
          topRight: r,
          bottomRight: r,
          bottomLeft: Radius.circular(lado * 0.1),
        ),
      ),
      alignment: Alignment.center,
      child: Text(
        '?',
        style: TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w700,
          fontSize: lado * 0.7,
          height: 1,
        ),
      ),
    );
  }
}

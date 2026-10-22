import 'package:flutter/material.dart';

/// Cores da marca (os mesmos tokens de `code/web/app/globals.css`).
class Cores {
  const Cores._();
  static const terracota = Color(0xFFB84A24);
  static const terracotaEscuro = Color(0xFF8E3517);
  static const terracotaSuave = Color(0xFFF2D8CB);
  static const creme = Color(0xFFF7F0E4);
  static const creme2 = Color(0xFFEDE3D1);
  static const papel = Color(0xFFFFFBF5);
  static const tinta = Color(0xFF15263B);
  static const tinta2 = Color(0xFF4A5868);
  static const tinta3 = Color(0xFF5B6572);
  static const linha = Color(0xFFE2D6C2);
  static const verde = Color(0xFF3F6E4A);
  static const verdeSuave = Color(0xFFDCE8D8);
  static const ambar = Color(0xFF8A5A00);
  static const ambarSuave = Color(0xFFF6E6C2);
}

/// Alvos de toque: nunca menos de 48 dp; os botões principais 56 dp.
const double alvoMinimo = 48;
const double alvoPrincipal = 56;

/// Tema para usar ao sol e com uma mão: letra grande, alto contraste (tinta
/// sobre creme/papel, ≥ 7:1 no texto principal), botões largos.
ThemeData temaToucamara() {
  const esquema = ColorScheme(
    brightness: Brightness.light,
    primary: Cores.terracota,
    onPrimary: Colors.white,
    primaryContainer: Cores.terracotaSuave,
    onPrimaryContainer: Cores.terracotaEscuro,
    secondary: Cores.tinta,
    onSecondary: Colors.white,
    secondaryContainer: Cores.creme2,
    onSecondaryContainer: Cores.tinta,
    tertiary: Cores.verde,
    onTertiary: Colors.white,
    error: Color(0xFFA1260F),
    onError: Colors.white,
    surface: Cores.papel,
    onSurface: Cores.tinta,
    onSurfaceVariant: Cores.tinta2,
    outline: Cores.tinta3,
    outlineVariant: Cores.linha,
    surfaceContainerHighest: Cores.creme2,
  );
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: esquema,
    fontFamily: 'Inter',
    scaffoldBackgroundColor: Cores.creme,
    visualDensity: VisualDensity.standard,
    materialTapTargetSize: MaterialTapTargetSize.padded,
  );
  final texto = base.textTheme
      .copyWith(
        headlineMedium: const TextStyle(
          fontSize: 28,
          fontWeight: FontWeight.w700,
          height: 1.2,
        ),
        headlineSmall: const TextStyle(
          fontSize: 24,
          fontWeight: FontWeight.w700,
          height: 1.25,
        ),
        titleLarge: const TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w700,
          height: 1.25,
        ),
        titleMedium: const TextStyle(
          fontSize: 19,
          fontWeight: FontWeight.w600,
          height: 1.3,
        ),
        bodyLarge: const TextStyle(fontSize: 18, height: 1.4),
        bodyMedium: const TextStyle(fontSize: 17, height: 1.4),
        bodySmall: const TextStyle(fontSize: 15, height: 1.35),
        labelLarge: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
        labelMedium: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      )
      .apply(bodyColor: Cores.tinta, displayColor: Cores.tinta);

  final formaBotao = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(16),
  );
  return base.copyWith(
    textTheme: texto,
    appBarTheme: const AppBarTheme(
      backgroundColor: Cores.creme,
      foregroundColor: Cores.tinta,
      elevation: 0,
      scrolledUnderElevation: 1,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontFamily: 'Inter',
        fontSize: 21,
        fontWeight: FontWeight.w700,
        color: Cores.tinta,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(alvoMinimo, alvoPrincipal),
        shape: formaBotao,
        textStyle: texto.labelLarge,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(alvoMinimo, alvoPrincipal),
        shape: formaBotao,
        foregroundColor: Cores.tinta,
        side: const BorderSide(color: Cores.tinta, width: 2),
        textStyle: texto.labelLarge,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(alvoMinimo, alvoMinimo),
        foregroundColor: Cores.terracotaEscuro,
        textStyle: texto.labelLarge,
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        minimumSize: const Size(alvoMinimo, alvoMinimo),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
      labelStyle: const TextStyle(fontSize: 18, color: Cores.tinta2),
      floatingLabelStyle: const TextStyle(fontSize: 18, color: Cores.tinta),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Cores.tinta3, width: 1.5),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Cores.tinta3, width: 1.5),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Cores.terracota, width: 3),
      ),
    ),
    cardTheme: CardThemeData(
      color: Cores.papel,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: Cores.linha, width: 1.5),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Cores.papel,
      indicatorColor: Cores.terracotaSuave,
      height: 72,
      labelTextStyle: WidgetStatePropertyAll(texto.labelMedium),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: SegmentedButton.styleFrom(
        minimumSize: const Size(alvoMinimo, alvoMinimo),
        textStyle: texto.labelLarge,
        selectedBackgroundColor: Cores.tinta,
        selectedForegroundColor: Colors.white,
        foregroundColor: Cores.tinta,
        side: const BorderSide(color: Cores.tinta, width: 1.5),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: Cores.tinta,
      contentTextStyle: texto.bodyLarge?.copyWith(color: Colors.white),
      behavior: SnackBarBehavior.floating,
    ),
    dividerTheme: const DividerThemeData(color: Cores.linha, thickness: 1.5),
  );
}

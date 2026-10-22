import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Chave → texto, persistente. Para a fila, a cache e as definições.
abstract class Armazem {
  Future<String?> ler(String chave);
  Future<void> escrever(String chave, String valor);
  Future<void> apagar(String chave);
}

/// SharedPreferences (Android: ficheiro privado da app; web: localStorage).
class ArmazemPreferencias implements Armazem {
  ArmazemPreferencias([SharedPreferencesAsync? prefs])
      : _prefs = prefs ?? SharedPreferencesAsync();
  final SharedPreferencesAsync _prefs;

  @override
  Future<String?> ler(String chave) => _prefs.getString(chave);

  @override
  Future<void> escrever(String chave, String valor) =>
      _prefs.setString(chave, valor);

  @override
  Future<void> apagar(String chave) => _prefs.remove(chave);
}

/// Para o token da sessão: Android Keystore (cifrado); web: WebCrypto.
class ArmazemSeguro implements Armazem {
  ArmazemSeguro([FlutterSecureStorage? s])
      : _s = s ?? const FlutterSecureStorage();
  final FlutterSecureStorage _s;

  @override
  Future<String?> ler(String chave) => _s.read(key: chave);

  @override
  Future<void> escrever(String chave, String valor) =>
      _s.write(key: chave, value: valor);

  @override
  Future<void> apagar(String chave) => _s.delete(key: chave);
}

/// Em memória (testes).
class ArmazemMemoria implements Armazem {
  ArmazemMemoria([Map<String, String>? inicial]) : dados = {...?inicial};
  final Map<String, String> dados;

  @override
  Future<String?> ler(String chave) async => dados[chave];

  @override
  Future<void> escrever(String chave, String valor) async =>
      dados[chave] = valor;

  @override
  Future<void> apagar(String chave) async => dados.remove(chave);
}

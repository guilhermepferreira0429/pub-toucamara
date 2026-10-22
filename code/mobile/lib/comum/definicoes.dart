import 'package:flutter/foundation.dart';

import 'armazenamento/armazem.dart';
import 'config.dart';

/// Servidor da API e município (equipa interna), guardados no telemóvel.
/// Por omissão vêm do `--dart-define` ([ConfigApp]).
class Definicoes extends ChangeNotifier {
  Definicoes(this._armazem);

  static const _chaveServidor = 'definicoes_servidor';
  static const _chaveMunicipio = 'definicoes_municipio';
  final Armazem _armazem;

  String servidor = ConfigApp.apiUrlPorOmissao;
  String municipio = ConfigApp.municipio;

  bool get servidorMudado => servidor != ConfigApp.apiUrlPorOmissao;

  Future<void> carregar() async {
    servidor = await _armazem.ler(_chaveServidor) ?? ConfigApp.apiUrlPorOmissao;
    municipio = await _armazem.ler(_chaveMunicipio) ?? ConfigApp.municipio;
    notifyListeners();
  }

  Future<void> guardar({required String servidor, String? municipio}) async {
    if (!ConfigApp.urlValido(servidor)) {
      throw ArgumentError('Endereço inválido (http:// ou https://).');
    }
    this.servidor = ConfigApp.normalizarUrl(servidor);
    await _armazem.escrever(_chaveServidor, this.servidor);
    if (municipio != null) {
      this.municipio = municipio.trim();
      await _armazem.escrever(_chaveMunicipio, this.municipio);
    }
    notifyListeners();
  }

  Future<void> repor() async {
    await _armazem.apagar(_chaveServidor);
    await _armazem.apagar(_chaveMunicipio);
    servidor = ConfigApp.apiUrlPorOmissao;
    municipio = ConfigApp.municipio;
    notifyListeners();
  }
}

import 'package:speech_to_text/speech_to_text.dart';

/// Ditado por voz no telemóvel (reconhecimento do sistema, em pt-PT). O
/// texto vai para a API como o relatório "texto" (a API estrutura-o).
abstract class Ditado {
  /// false se o aparelho não tiver reconhecimento de voz (ou sem permissão).
  Future<bool> preparar();
  bool get aOuvir;
  Future<void> comecar(void Function(String texto, bool fim) aoOuvir);
  Future<void> parar();
}

class DitadoSistema implements Ditado {
  final SpeechToText _stt = SpeechToText();
  bool _pronto = false;
  String? _local;

  @override
  bool get aOuvir => _stt.isListening;

  @override
  Future<bool> preparar() async {
    if (_pronto) return true;
    try {
      _pronto = await _stt.initialize(onError: (_) {});
      if (_pronto) {
        final locais = await _stt.locales();
        final pt = locais.where(
          (l) => l.localeId.toLowerCase().startsWith('pt'),
        );
        _local = pt
            .firstWhere(
              (l) => l.localeId.toLowerCase().replaceAll('-', '_') == 'pt_pt',
              orElse: () => pt.isNotEmpty ? pt.first : locais.first,
            )
            .localeId;
      }
    } on Object {
      _pronto = false;
    }
    return _pronto;
  }

  @override
  Future<void> comecar(void Function(String texto, bool fim) aoOuvir) async {
    if (!await preparar()) return;
    await _stt.listen(
      onResult: (r) => aoOuvir(r.recognizedWords, r.finalResult),
      listenOptions: SpeechListenOptions(
        localeId: _local ?? 'pt_PT',
        listenMode: ListenMode.dictation,
        partialResults: true,
        cancelOnError: true,
        listenFor: const Duration(minutes: 2),
        pauseFor: const Duration(seconds: 6),
      ),
    );
  }

  @override
  Future<void> parar() => _stt.stop();
}

/// Sem reconhecimento (testes e aparelhos sem serviço de voz).
class DitadoIndisponivel implements Ditado {
  @override
  bool get aOuvir => false;
  @override
  Future<bool> preparar() async => false;
  @override
  Future<void> comecar(void Function(String texto, bool fim) aoOuvir) async {}
  @override
  Future<void> parar() async {}
}

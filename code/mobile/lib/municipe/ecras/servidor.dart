import 'package:flutter/material.dart';

import '../../comum/api/cliente_api.dart';
import '../../comum/componentes/componentes.dart';
import '../../comum/config.dart';
import '../../comum/tema.dart';
import '../config.dart';
import '../servicos.dart';

/// Servidor da API e município (escondido: cinco toques na marca em
/// "Entrar", ou em Definições → Servidor), para testes e demonstrações.
class EcraServidor extends StatefulWidget {
  const EcraServidor({super.key});

  @override
  State<EcraServidor> createState() => _EcraServidorState();
}

class _EcraServidorState extends State<EcraServidor> {
  TextEditingController? _servidorC;
  TextEditingController? _municipioC;
  String? _resultado;
  bool _ok = false;
  bool _aTestar = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_servidorC != null) return;
    final s = FornecedorMunicipe.de(context);
    _servidorC = TextEditingController(text: s.definicoes.servidor);
    _municipioC = TextEditingController(text: s.municipio);
  }

  @override
  void dispose() {
    _servidorC?.dispose();
    _municipioC?.dispose();
    super.dispose();
  }

  Future<void> _testar() async {
    if (!ConfigApp.urlValido(_servidorC!.text)) {
      setState(() {
        _ok = false;
        _resultado = 'Endereço inválido: comece por http:// ou https://.';
      });
      return;
    }
    setState(() => _aTestar = true);
    final teste = ClienteApi(
      servidor: () => ConfigApp.normalizarUrl(_servidorC!.text),
      limite: const Duration(seconds: 8),
    );
    try {
      await teste.get('/saude');
      setState(() {
        _ok = true;
        _resultado = 'A API respondeu.';
      });
    } on ErroApi catch (e) {
      setState(() {
        _ok = false;
        _resultado = 'O servidor respondeu com erro: ${e.mensagem}';
      });
    } on SemRede catch (e) {
      setState(() {
        _ok = false;
        _resultado = 'Sem resposta: ${e.motivo}';
      });
    } finally {
      if (mounted) setState(() => _aTestar = false);
    }
  }

  Future<void> _guardar() async {
    final d = FornecedorMunicipe.de(context).definicoes;
    try {
      await d.guardar(servidor: _servidorC!.text, municipio: _municipioC!.text);
      if (mounted) {
        avisar(context, 'Guardado.');
        Navigator.of(context).pop();
      }
    } on ArgumentError catch (e) {
      setState(() {
        _ok = false;
        _resultado = '${e.message}';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = FornecedorMunicipe.de(context).definicoes;
    return Scaffold(
      appBar: AppBar(title: const Text('Servidor')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            'Só para testes. Endereço da API central, sem o /v1. Por omissão: ${ConfigApp.apiUrlPorOmissao}',
            style: Theme.of(
              context,
            ).textTheme.bodyLarge?.copyWith(color: Cores.tinta2),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _servidorC,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Servidor da API',
              prefixIcon: Icon(Icons.dns),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _municipioC,
            autocorrect: false,
            decoration: InputDecoration(
              labelText: 'Município',
              helperText: 'Por omissão: ${ConfigMunicipe.municipio}',
              prefixIcon: const Icon(Icons.location_city),
            ),
          ),
          const SizedBox(height: 20),
          OutlinedButton.icon(
            onPressed: _aTestar ? null : _testar,
            icon: const Icon(Icons.wifi_tethering),
            label: Text(_aTestar ? 'A testar…' : 'Testar ligação'),
          ),
          if (_resultado != null) ...[
            const SizedBox(height: 12),
            Pilula(
              _resultado!,
              tom: _ok ? TomPilula.verde : TomPilula.ambar,
              icone: _ok ? Icons.check_circle : Icons.warning_amber_rounded,
            ),
          ],
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _guardar,
            icon: const Icon(Icons.save_rounded),
            label: const Text('Guardar'),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: () async {
              await d.repor();
              _servidorC!.text = d.servidor;
              _municipioC!.text = ConfigMunicipe.municipio;
              if (context.mounted) {
                avisar(context, 'Reposto o servidor por omissão.');
              }
            },
            child: const Text('Repor o servidor por omissão'),
          ),
        ],
      ),
    );
  }
}

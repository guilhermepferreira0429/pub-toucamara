import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../comum/api/cliente_api.dart';
import '../../comum/componentes/componentes.dart';
import '../../comum/componentes/marca.dart';
import '../../comum/tema.dart';
import '../sessao.dart';
import '../servicos.dart';
import 'servidor.dart';

/// Entrar: o número de telemóvel → código por SMS → entrar.
class EcraEntrar extends StatefulWidget {
  const EcraEntrar({super.key});

  @override
  State<EcraEntrar> createState() => _EcraEntrarState();
}

class _EcraEntrarState extends State<EcraEntrar> {
  final _telefone = TextEditingController();
  final _codigo = TextEditingController();
  bool _codigoPedido = false;
  bool _ocupado = false;
  String? _erro;
  String? _mascarado;
  int _toques = 0;

  @override
  void dispose() {
    _telefone.dispose();
    _codigo.dispose();
    super.dispose();
  }

  Future<void> _pedir() async {
    if (!ControladorSessaoMunicipe.telefoneValido(_telefone.text)) {
      setState(
        () => _erro =
            'Escreva o número do seu telemóvel (9 algarismos, começa por 9).',
      );
      return;
    }
    final sessao = FornecedorMunicipe.de(context).sessao;
    await _correr(() async {
      final m = await sessao.pedirCodigo(_telefone.text);
      if (mounted) {
        setState(() {
          _mascarado = m;
          _codigoPedido = true;
        });
      }
    });
  }

  Future<void> _entrar() async {
    if (!RegExp(r'^\d{6}$').hasMatch(_codigo.text.trim())) {
      setState(() => _erro = 'O código tem 6 algarismos.');
      return;
    }
    final sessao = FornecedorMunicipe.de(context).sessao;
    await _correr(() => sessao.entrar(_telefone.text, _codigo.text));
  }

  Future<void> _correr(Future<void> Function() f) async {
    setState(() {
      _ocupado = true;
      _erro = null;
    });
    try {
      await f();
    } on ErroApi catch (e) {
      if (!mounted) return;
      final resto = e.detalhes['tentativas_restantes'];
      setState(
        () => _erro = resto != null
            ? '${e.mensagem} Restam $resto tentativas.'
            : e.mensagem,
      );
    } on SemRede {
      if (!mounted) return;
      setState(
        () => _erro = 'Sem ligação à internet. Para entrar é preciso rede.',
      );
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  void _tocarMarca() {
    if (++_toques >= 5) {
      _toques = 0;
      Navigator.of(
        context,
      ).push(MaterialPageRoute(builder: (_) => const EcraServidor()));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = FornecedorMunicipe.de(context);
    final texto = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  GestureDetector(
                    onTap: _tocarMarca,
                    behavior: HitTestBehavior.opaque,
                    child: const Align(
                      alignment: Alignment.centerLeft,
                      child: Marca(grande: true),
                    ),
                  ),
                  const SizedBox(height: 28),
                  Semantics(
                    header: true,
                    child: Text('Entrar', style: texto.headlineMedium),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _codigoPedido
                        ? 'Enviámos um SMS com um código de 6 algarismos para ${_mascarado ?? _telefone.text}. É válido 10 minutos.'
                        : 'Escreva o número do seu telemóvel. Enviamos-lhe um código por SMS para confirmar que é seu.',
                    style: texto.bodyLarge?.copyWith(color: Cores.tinta2),
                  ),
                  if (s.sessao.aviso != null) ...[
                    const SizedBox(height: 16),
                    ErroLinha(s.sessao.aviso!),
                  ],
                  const SizedBox(height: 24),
                  if (!_codigoPedido) ...[
                    TextField(
                      controller: _telefone,
                      keyboardType: TextInputType.phone,
                      autofillHints: const [AutofillHints.telephoneNumber],
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _pedir(),
                      style: const TextStyle(fontSize: 24, letterSpacing: 1),
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]')),
                        LengthLimitingTextInputFormatter(20),
                      ],
                      decoration: const InputDecoration(
                        labelText: 'Número de telemóvel',
                        hintText: '912 345 678',
                        prefixIcon: Icon(Icons.phone_android_rounded),
                      ),
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      onPressed: _ocupado ? null : _pedir,
                      icon: const Icon(Icons.sms_rounded),
                      label: const Text('Enviar código por SMS'),
                    ),
                  ] else ...[
                    TextField(
                      controller: _codigo,
                      keyboardType: TextInputType.number,
                      autofillHints: const [AutofillHints.oneTimeCode],
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(6),
                      ],
                      textAlign: TextAlign.center,
                      onSubmitted: (_) => _entrar(),
                      style: const TextStyle(
                        fontSize: 34,
                        letterSpacing: 10,
                        fontWeight: FontWeight.w700,
                      ),
                      decoration: const InputDecoration(
                        labelText: 'Código do SMS',
                        hintText: '000000',
                      ),
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      onPressed: _ocupado ? null : _entrar,
                      icon: const Icon(Icons.login_rounded),
                      label: const Text('Entrar'),
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: _ocupado
                          ? null
                          : () => setState(() {
                              _codigoPedido = false;
                              _codigo.clear();
                              _erro = null;
                            }),
                      child: const Text('Mudar o número ou pedir outro código'),
                    ),
                  ],
                  if (_ocupado) ...[
                    const SizedBox(height: 16),
                    const Center(child: CircularProgressIndicator()),
                  ],
                  if (_erro != null) ...[
                    const SizedBox(height: 16),
                    ErroLinha(_erro!),
                  ],
                  const SizedBox(height: 28),
                  const _Porque(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Porquê o telemóvel e o que fica guardado.
class _Porque extends StatelessWidget {
  const _Porque();

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    Widget linha(IconData i, String texto) => Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(i, color: Cores.tinta2),
          const SizedBox(width: 10),
          Expanded(child: Text(texto, style: t.bodyMedium)),
        ],
      ),
    );
    return Cartao(
      cor: Cores.creme2,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Porquê o telemóvel?', style: t.titleMedium),
          linha(
            Icons.folder_shared_outlined,
            'É o mesmo número com que fala com a câmara: assim vê aqui os seus pedidos, pagamentos e problemas reportados.',
          ),
          linha(
            Icons.lock_outline_rounded,
            'Neste telemóvel fica só uma chave de sessão, guardada de forma cifrada. Pode sair quando quiser em Definições.',
          ),
          linha(
            Icons.notifications_none_rounded,
            'Só lhe enviamos avisos que escolher (e os de emergência).',
          ),
        ],
      ),
    );
  }
}

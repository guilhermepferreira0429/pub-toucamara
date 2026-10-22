import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../comum/api/cliente_api.dart';
import '../../comum/componentes/componentes.dart';
import '../../comum/componentes/marca.dart';
import '../../comum/tema.dart';
import '../servicos.dart';
import 'definicoes.dart';

/// Entrar: o email do painel → código de 6 dígitos que chega por email.
class EcraEntrar extends StatefulWidget {
  const EcraEntrar({super.key});

  @override
  State<EcraEntrar> createState() => _EcraEntrarState();
}

class _EcraEntrarState extends State<EcraEntrar> {
  final _email = TextEditingController();
  final _codigo = TextEditingController();
  bool _codigoPedido = false;
  bool _ocupado = false;
  String? _erro;
  int _toques = 0;
  int _validade = 10;

  @override
  void dispose() {
    _email.dispose();
    _codigo.dispose();
    super.dispose();
  }

  bool get _emailValido =>
      RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(_email.text.trim());

  Future<void> _pedir() async {
    if (!_emailValido) {
      setState(() => _erro = 'Escreva o email com que entra no painel.');
      return;
    }
    final sessao = FornecedorServicos.de(context).sessao;
    await _correr(() async {
      _validade = await sessao.pedirCodigo(_email.text);
      if (mounted) setState(() => _codigoPedido = true);
    });
  }

  Future<void> _entrar() async {
    if (!RegExp(r'^\d{6}$').hasMatch(_codigo.text.trim())) {
      setState(() => _erro = 'O código tem 6 algarismos.');
      return;
    }
    final sessao = FornecedorServicos.de(context).sessao;
    await _correr(() => sessao.entrar(_email.text, _codigo.text));
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
      setState(() => _erro = resto != null
          ? '${e.mensagem} Restam $resto tentativas.'
          : e.mensagem);
    } on SemRede {
      if (!mounted) return;
      setState(() => _erro =
          'Sem ligação ao servidor. Para entrar é preciso rede (depois a app funciona sem ela).');
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  void _tocarMarca() {
    // Cinco toques na marca abrem as definições do servidor (escondidas).
    if (++_toques >= 5) {
      _toques = 0;
      Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const EcraDefinicoes()));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = FornecedorServicos.de(context);
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
                        child: Marca(sufixo: 'Equipa', grande: true)),
                  ),
                  const SizedBox(height: 28),
                  Text('Entrar', style: texto.headlineMedium),
                  const SizedBox(height: 8),
                  Text(
                    _codigoPedido
                        ? 'Enviámos um código de 6 algarismos para ${_email.text.trim()}. É válido $_validade minutos.'
                        : 'Use o email com que entra no painel da câmara. Enviamos-lhe um código.',
                    style: texto.bodyLarge?.copyWith(color: Cores.tinta2),
                  ),
                  if (s.sessao.aviso != null) ...[
                    const SizedBox(height: 16),
                    ErroLinha(s.sessao.aviso!),
                  ],
                  const SizedBox(height: 24),
                  if (!_codigoPedido) ...[
                    TextField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _pedir(),
                      style: const TextStyle(fontSize: 20),
                      decoration: const InputDecoration(
                          labelText: 'Email',
                          prefixIcon: Icon(Icons.mail_outline_rounded)),
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      onPressed: _ocupado ? null : _pedir,
                      icon: const Icon(Icons.send_rounded),
                      label: const Text('Enviar código'),
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
                          fontWeight: FontWeight.w700),
                      decoration: const InputDecoration(
                          labelText: 'Código', hintText: '000000'),
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
                      child: const Text('Mudar o email ou pedir outro código'),
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
                  const SizedBox(height: 32),
                  ListenableBuilder(
                    listenable: s.definicoes,
                    builder: (context, _) => Text(
                      s.definicoes.servidorMudado
                          ? 'Servidor: ${s.definicoes.servidor}'
                          : 'Só para funcionários da câmara com trabalho no terreno.',
                      style: texto.bodySmall?.copyWith(color: Cores.tinta3),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/routes.dart';
import '../../../core/feedback/feedback.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/inputs.dart';
import '../application/brain_connection.dart';
import '../domain/brain_pairing.dart';

/// Pair this phone with Lefi Brain (ADR-068): the main PC's address and a pairing code made
/// in Lefi Crop Helper (or with `lefi pair new` on the main PC). The code is never sent.
class ConnectScreen extends ConsumerStatefulWidget {
  const ConnectScreen({super.key});

  @override
  ConsumerState<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends ConsumerState<ConnectScreen> {
  final _address = TextEditingController(text: 'lefi-main.local');
  final _code = TextEditingController();
  final _name = TextEditingController(text: 'Lefi Crop mobile');
  String _error = '';

  @override
  void dispose() {
    _address.dispose();
    _code.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _pair() async {
    setState(() => _error = '');
    try {
      await ref
          .read(busyProvider.notifier)
          .run(
            'Pairing with Lefi Brain…',
            () => ref
                .read(brainConnectionProvider.notifier)
                .pair(address: _address.text, code: _code.text, deviceName: _name.text.trim()),
          );
      if (!mounted) return;
      ref.read(toastProvider.notifier).show('Paired with Lefi Brain. Sign in with your Lefi account.');
      context.go(Routes.login);
    } on BrainException catch (e) {
      setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: LefiColors.screen,
    appBar: AppBar(title: const Text('Connect to Lefi Brain')),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(
          'Pair this phone once. On the main PC, open Lefi Crop Helper → Apps → Lefi Desktop connections → Create a pairing code '
          '(technicians: lefi pair new). The phone must be on the greenhouse Wi-Fi.',
          style: LefiText.body(14, color: LefiColors.subtle, height: 1.45),
        ),
        const SizedBox(height: 18),
        FieldLabel(
          'Lefi Brain address',
          child: LefiTextField(
            controller: _address,
            keyboardType: TextInputType.url,
            hint: 'lefi-main.local or 192.168.8.10',
            onChanged: (_) => setState(() => _error = ''),
          ),
        ),
        const SizedBox(height: 14),
        FieldLabel(
          'Pairing code',
          child: LefiTextField(
            controller: _code,
            mono: true,
            hint: 'ABCD-EFGH-JKMN',
            textCapitalization: TextCapitalization.characters,
            onChanged: (_) => setState(() => _error = ''),
          ),
        ),
        const SizedBox(height: 14),
        FieldLabel(
          'Name of this phone',
          child: LefiTextField(controller: _name, onSubmitted: (_) => _pair()),
        ),
        if (_error.isNotEmpty) ...[
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            decoration: BoxDecoration(color: const Color(0xFFFBE4E2), borderRadius: BorderRadius.circular(10)),
            child: Text(_error, style: LefiText.body(13, color: LefiColors.dangerDeep)),
          ),
        ],
        const SizedBox(height: 18),
        LefiButton(label: 'Pair', onPressed: _pair),
      ],
    ),
  );
}

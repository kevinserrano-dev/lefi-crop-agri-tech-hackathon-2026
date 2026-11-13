import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../core/feedback/feedback.dart';
import '../../../core/platform/platform_style.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/inputs.dart';
import '../../../core/widgets/primitives.dart';

import 'package:go_router/go_router.dart';

import '../../../app/router/routes.dart';
import '../../../shared/domain/role.dart';
import '../../brain/application/brain_connection.dart';
import '../../brain/data/brain_auth_repository.dart';
import '../../brain/domain/brain_pairing.dart';
import '../application/session.dart';
import '../data/demo_auth_repository.dart';
import '../domain/auth_repository.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  late final List<UserProfile> _accounts = ref.read(authRepositoryProvider).demoAccounts();
  late UserProfile _selected = _accounts.firstWhere((u) => u.role == Role.supervisor);
  late final _email = TextEditingController(text: _brain ? '' : _selected.email);
  // Demo-only placeholder password (no real credentials exist in the app).
  late final _password = TextEditingController(text: _brain ? '' : 'greenhouse26');
  bool get _brain => ref.read(brainConnectionProvider).value != null;
  String _error = '';

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    try {
      await ref
          .read(busyProvider.notifier)
          .run('Signing in…', () => ref.read(sessionProvider.notifier).signIn(_email.text, _password.text));
    } on PasswordChangeRequired {
      if (mounted) await _changePassword();
    } on AuthException catch (e) {
      setState(() => _error = e.message);
    }
  }

  /// Lefi Brain asks for a new password first (bootstrap admin, reset).
  Future<void> _changePassword() async {
    final next = TextEditingController();
    final again = TextEditingController();
    var error = '';
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Choose a new password'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Lefi Brain asks you to change your password before continuing.', style: LefiText.body(13)),
              const SizedBox(height: 12),
              FieldLabel('New password', child: LefiTextField(controller: next, obscure: true)),
              const SizedBox(height: 10),
              FieldLabel('Repeat it', child: LefiTextField(controller: again, obscure: true)),
              if (error.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(error, style: LefiText.body(13, color: LefiColors.dangerDeep)),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: () async {
                await ref.read(sessionProvider.notifier).signOut();
                if (ctx.mounted) Navigator.of(ctx).pop();
              },
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () async {
                if (next.text != again.text) return setLocal(() => error = 'The two passwords differ.');
                try {
                  await ref.read(sessionProvider.notifier).changePassword(_password.text, next.text);
                  if (ctx.mounted) Navigator.of(ctx).pop();
                } on AuthException catch (e) {
                  setLocal(() => error = e.message);
                }
              },
              child: const Text('Change'),
            ),
          ],
        ),
      ),
    );
    next.dispose();
    again.dispose();
  }

  Future<void> _bio(bool ios) => ref
      .read(busyProvider.notifier)
      .run(ios ? 'Face ID…' : 'Verifying…', () => ref.read(sessionProvider.notifier).unlockWithBiometrics(_selected));

  @override
  Widget build(BuildContext context) {
    final ios = context.isCupertino;
    final pairing = ref.watch(brainConnectionProvider).value;
    final brain = pairing != null;
    ref.listen(brainConnectionProvider, (prev, next) {
      final nowBrain = next.value != null;
      if ((prev?.value != null) == nowBrain) return;
      _email.text = nowBrain ? '' : _selected.email;
      _password.text = nowBrain ? '' : 'greenhouse26';
      setState(() => _error = '');
    });
    final top = MediaQuery.paddingOf(context).top;
    return AnnotatedRegion(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        backgroundColor: LefiColors.screen,
        body: ListView(
          padding: EdgeInsets.zero,
          children: [
            Container(
              constraints: BoxConstraints(minHeight: 250 + top),
              padding: EdgeInsets.fromLTRB(24, 14 + top, 24, 46),
              clipBehavior: Clip.hardEdge,
              decoration: const BoxDecoration(color: LefiColors.brandDark),
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Positioned(right: -30, bottom: -76, child: Image.asset('assets/brand/mascot-hero.png', width: 150)),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 60,
                        height: 60,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
                        child: Image.asset('assets/brand/logo-mark.png', width: 46, height: 46, fit: BoxFit.contain),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'Lefi Crop',
                        style: LefiText.outfit(32, weight: 700, color: Colors.white, letterSpacing: -0.3),
                      ),
                      const SizedBox(height: 12),
                      SizedBox(
                        width: 190,
                        child: Text(
                          'AI-Powered Greenhouse Operations',
                          style: LefiText.body(14, color: LefiColors.mint, height: 1.45),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            // The sign-in card overlaps the hero by 28 px (design: margin-top -28px).
            Transform.translate(
              offset: const Offset(0, -28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    margin: const EdgeInsets.symmetric(horizontal: 16),
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(22),
                      boxShadow: const [BoxShadow(color: Color(0x1A163D32), blurRadius: 30, offset: Offset(0, 10))],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text('Sign in to your shift', style: LefiText.outfit(21)),
                        const SizedBox(height: 14),
                        if (brain) ...[_BrainRow(pairing: pairing), const SizedBox(height: 14)],
                        FieldLabel(
                          brain ? 'Username' : 'Work email',
                          child: LefiTextField(
                            controller: _email,
                            keyboardType: brain ? TextInputType.text : TextInputType.emailAddress,
                            onChanged: (_) => setState(() => _error = ''),
                          ),
                        ),
                        const SizedBox(height: 14),
                        FieldLabel(
                          'Password',
                          child: LefiTextField(
                            controller: _password,
                            obscure: true,
                            onChanged: (_) => setState(() => _error = ''),
                            onSubmitted: (_) => _signIn(),
                          ),
                        ),
                        if (_error.isNotEmpty) ...[
                          const SizedBox(height: 14),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFBE4E2),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text(_error, style: LefiText.body(13, color: LefiColors.dangerDeep)),
                          ),
                        ],
                        const SizedBox(height: 14),
                        LefiButton(label: 'Sign in', onPressed: _signIn),
                        const SizedBox(height: 14),
                        if (brain)
                          LefiOutlineButton(
                            label: 'Forget this Lefi Brain',
                            icon: Symbols.link_off_rounded,
                            onPressed: () => ref.read(brainConnectionProvider.notifier).forget(),
                          )
                        else ...[
                          LefiOutlineButton(
                            label: ios ? 'Sign in with Face ID' : 'Sign in with fingerprint',
                            icon: ios ? Symbols.face_rounded : Symbols.fingerprint_rounded,
                            onPressed: () => _bio(ios),
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (!brain)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Overline('Demo accounts'),
                          const SizedBox(height: 8),
                          LayoutBuilder(
                            builder: (context, c) => Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              children: [
                                for (final u in _accounts)
                                  SizedBox(
                                    width: (c.maxWidth - 6) / 2,
                                    child: ConstrainedBox(
                                      constraints: const BoxConstraints(minHeight: 48),
                                      child: Material(
                                        color: u == _selected ? LefiColors.brandTint : Colors.white,
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(12),
                                          side: BorderSide(
                                            color: u == _selected ? LefiColors.brand : LefiColors.border,
                                          ),
                                        ),
                                        child: InkWell(
                                          borderRadius: BorderRadius.circular(12),
                                          onTap: () => setState(() {
                                            _selected = u;
                                            _email.text = u.email;
                                            _error = '';
                                          }),
                                          child: Padding(
                                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              mainAxisAlignment: MainAxisAlignment.center,
                                              children: [
                                                Text(
                                                  u.short,
                                                  style: LefiText.body(13, weight: 700, color: LefiColors.ink),
                                                ),
                                                Text(u.name, style: LefiText.body(11.5, color: LefiColors.subtle)),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 14),
                          LefiOutlineButton(
                            label: 'Connect to Lefi Brain',
                            icon: Symbols.lan_rounded,
                            onPressed: () => context.push(Routes.connect),
                          ),
                          const SizedBox(height: 14),
                          Text(
                            'Lefi Farms · Leamington, ON · v3.0.0 · demo accounts',
                            textAlign: TextAlign.center,
                            style: LefiText.body(11.5, color: LefiColors.faint),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Which Lefi Brain this phone is paired with (ADR-068).
class _BrainRow extends StatelessWidget {
  const _BrainRow({required this.pairing});
  final BrainPairing pairing;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    decoration: BoxDecoration(color: LefiColors.brandTint, borderRadius: BorderRadius.circular(12)),
    child: Row(
      children: [
        const Icon(Symbols.lan_rounded, size: 20, color: LefiColors.brand),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Lefi Brain', style: LefiText.body(13, weight: 800)),
              Text(pairing.url, style: LefiText.body(12, color: LefiColors.subtle)),
            ],
          ),
        ),
      ],
    ),
  );
}

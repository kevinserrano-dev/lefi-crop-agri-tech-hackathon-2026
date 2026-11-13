import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/auth/application/session.dart';
import 'package:lefi_mobile/features/auth/domain/auth_repository.dart';
import 'package:lefi_mobile/features/greenhouse/application/greenhouse_providers.dart';
import 'package:lefi_mobile/features/greenhouse/domain/greenhouse.dart';
import 'package:lefi_mobile/features/inspection/application/inspection_form.dart';
import 'package:lefi_mobile/features/tasks/application/tasks_controller.dart';
import 'package:lefi_mobile/features/tasks/domain/task.dart';

Future<ProviderContainer> signedIn(String email) async {
  final c = ProviderContainer();
  addTearDown(c.dispose);
  await c.read(sessionProvider.notifier).signIn(email, 'greenhouse26');
  return c;
}

void main() {
  group('session', () {
    test('rejects malformed email and short password', () async {
      final c = ProviderContainer();
      addTearDown(c.dispose);
      final s = c.read(sessionProvider.notifier);
      await expectLater(s.signIn('not-an-email', 'greenhouse26'), throwsA(isA<AuthException>()));
      await expectLater(s.signIn('marcus.okafor@leficrop.ca', 'short'), throwsA(isA<AuthException>()));
      expect(c.read(sessionProvider), isNull);
    });

    test('signs in a demo account', () async {
      final c = await signedIn('amrit.gill@leficrop.ca');
      expect(c.read(currentUserProvider).name, 'Amrit Gill');
    });
  });

  group('tasks', () {
    test('start → toggle step → complete', () async {
      final c = await signedIn('marcus.okafor@leficrop.ca');
      final ctl = c.read(tasksControllerProvider.notifier);
      await c.read(tasksControllerProvider.future);
      await ctl.start('T-1189');
      expect(ctl.byId('T-1189').status, TaskStatus.inProgress);
      ctl.toggleStep('T-1189', 0);
      expect(ctl.byId('T-1189').doneSteps, {0});
      await ctl.complete('T-1189');
      expect(ctl.byId('T-1189').status, TaskStatus.completed);
    });
  });

  group('inspection', () {
    test('finds a plant by position inside the user scope only', () async {
      final c = await signedIn('amrit.gill@leficrop.ca'); // worker: GH1-Z2, GH1-Z3
      await c.read(plantsProvider.future);
      final form = c.read(inspectionFormProvider(null).notifier);
      final sub = c.listen(inspectionFormProvider(null), (_, _) {});
      addTearDown(sub.close);

      form.setQuery('b-03');
      await form.find();
      expect(c.read(inspectionFormProvider(null)).plant?.id, 'P-0408');

      form.setQuery('P-0433'); // GH2-Z3 → outside the worker's zones
      await form.find();
      expect(c.read(inspectionFormProvider(null)).plant, isNull);
      expect(c.read(inspectionFormProvider(null)).error, contains('No plant'));
    });

    test('submit needs a photo or a symptom and saves a HUMAN observation', () async {
      final c = await signedIn('hana.kim@leficrop.ca');
      await c.read(plantsProvider.future);
      final sub = c.listen(inspectionFormProvider('P-0412'), (_, _) {});
      addTearDown(sub.close);
      final form = c.read(inspectionFormProvider('P-0412').notifier);

      await expectLater(form.submit(), throwsA(isA<InspectionValidation>()));
      form.toggleSymptom('Brown leaf edges');
      await form.submit();

      final saved = c.read(sessionObservationsProvider)['P-0412']!.single;
      expect(saved.source, ObservationSource.human);
      expect(saved.author, startsWith('Hana Kim'));
      expect(saved.text, contains('Brown leaf edges'));
    });
  });
}

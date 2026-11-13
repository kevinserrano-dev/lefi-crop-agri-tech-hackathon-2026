import 'dart:typed_data';

import 'package:image_picker/image_picker.dart';

/// A photo taken with the phone's camera (or chosen from its library), as JPEG bytes small enough
/// for Lefi Brain's 5 MB limit. Null when the person cancels. Nothing leaves the phone here.
Future<Uint8List?> capturePhoto({bool fromLibrary = false}) async {
  final file = await ImagePicker().pickImage(
    source: fromLibrary ? ImageSource.gallery : ImageSource.camera,
    maxWidth: 1920,
    maxHeight: 1920,
    imageQuality: 82,
    requestFullMetadata: false, // no location or other EXIF data
  );
  return file?.readAsBytes();
}

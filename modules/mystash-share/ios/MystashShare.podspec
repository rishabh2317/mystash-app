Pod::Spec.new do |s|
  s.name = 'MystashShare'
  s.version = '1.0.0'
  s.summary = 'Private native share capture for Mystash'
  s.description = 'Durable native capture and acceptance delivery; no extraction logic.'
  s.license = { :type => 'Proprietary' }
  s.author = 'Mystash'
  s.homepage = 'https://mystash.app'
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'ShareCore.swift', 'MystashShareModule.swift'
  s.swift_version = '5.9'
  s.test_spec 'Tests' do |test|
    test.source_files = 'Tests/*.swift'
    test.resources = '../fixtures/*.json'
    test.requires_app_host = true
  end
end

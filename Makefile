# Makefile for Biyan Desktop App - Build, Lint, Test, and Clean

REPORT_PORTAL_URL ?= ""
REPORT_PORTAL_API_KEY ?= ""
REPORT_PORTAL_PROJECT_NAME ?= ""
REPORT_PORTAL_LAUNCH_NAME ?= "Biyan App"
REPORT_PORTAL_DESCRIPTION ?= "Biyan App report"
MACOS_SIGNING_IDENTITY ?= Developer ID Application: LILYN DYNAMICS (7NZP53ZJ4D)

# Detect OS
ifeq ($(OS),Windows_NT)
    DETECTED_OS := Windows
else
    DETECTED_OS := $(shell uname -s)
endif

ifeq ($(OS),Windows_NT)
    MKDIR = if not exist "$(1)" mkdir "$(1)"
else
    MKDIR = mkdir -p $(1)
endif

# Default target, does nothing
all:
	@echo "Specify a target to run"

# Installs yarn dependencies and builds core and extensions
install-and-build:
ifeq ($(DETECTED_OS),Windows)
	echo "skip"
else ifeq ($(DETECTED_OS),Linux)
	chmod +x src-tauri/build-utils/*
endif
	yarn install --immutable
	yarn build:tauri:plugin:api
	yarn build:core
	yarn build:extensions

# Install required Rust targets for macOS universal builds
install-rust-targets:
ifeq ($(DETECTED_OS),Darwin)
	@echo "Detected macOS, installing universal build targets..."
	rustup target add x86_64-apple-darwin
	rustup target add aarch64-apple-darwin
	@echo "Rust targets installed successfully!"
else
	@echo "Not macOS; skipping Rust target installation."
endif

# Install required Rust targets for Android builds
install-android-rust-targets:
	@echo "Checking and installing Android Rust targets..."
	@rustup target list --installed | grep -q "aarch64-linux-android" || rustup target add aarch64-linux-android
	@rustup target list --installed | grep -q "armv7-linux-androideabi" || rustup target add armv7-linux-androideabi
	@rustup target list --installed | grep -q "i686-linux-android" || rustup target add i686-linux-android
	@rustup target list --installed | grep -q "x86_64-linux-android" || rustup target add x86_64-linux-android
	@echo "Android Rust targets ready!"

# Install required Rust targets for iOS builds
install-ios-rust-targets:
	@echo "Checking and installing iOS Rust targets..."
	@rustup target list --installed | grep -q "aarch64-apple-ios" || rustup target add aarch64-apple-ios
	@rustup target list --installed | grep -q "aarch64-apple-ios-sim" || rustup target add aarch64-apple-ios-sim
	@rustup target list --installed | grep -q "x86_64-apple-ios" || rustup target add x86_64-apple-ios
	@echo "iOS Rust targets ready!"

dev: install-and-build
	yarn download:bin
	make build-cli-dev
	yarn dev

# Web application targets
install-web-app:
	yarn install --immutable

dev-web-app: install-web-app
	yarn build:core
	yarn dev:web-app

build-web-app: install-web-app
	yarn build:core
	yarn build:web-app

serve-web-app:
	yarn serve:web-app

build-serve-web-app: build-web-app
	yarn serve:web-app

# Mobile
dev-android: install-and-build install-android-rust-targets
	@echo "Setting up Android development environment..."
	@if [ ! -d "src-tauri/gen/android" ]; then \
		echo "Android app not initialized. Initializing..."; \
		yarn tauri android init; \
	fi
	@echo "Sourcing Android environment setup..."
	@bash autoqa/scripts/setup-android-env.sh echo "Android environment ready"
	@echo "Starting Android development server..."
	yarn dev:android

dev-ios: install-and-build install-ios-rust-targets
	@echo "Setting up iOS development environment..."
ifeq ($(DETECTED_OS),Darwin)
	@if [ ! -d "src-tauri/gen/ios" ]; then \
		echo "iOS app not initialized. Initializing..."; \
		yarn tauri ios init; \
	fi
	@echo "Checking iOS development requirements..."
	@xcrun --version > /dev/null 2>&1 || (echo "❌ Xcode command line tools not found. Install with: xcode-select --install" && exit 1)
	@xcrun simctl list devices available | grep -q "iPhone\|iPad" || (echo "❌ No iOS simulators found. Install simulators through Xcode." && exit 1)
	@echo "Starting iOS development server..."
	yarn dev:ios
else
	@echo "❌ iOS development is only supported on macOS"
	@exit 1
endif

# Linting
lint: install-and-build
	yarn lint

# Testing
test: lint install-rust-targets
	yarn download:bin
ifeq ($(DETECTED_OS),Windows)
endif
	yarn test
	node --test ./scripts/__tests__/windows-installer-template.test.mjs
	node --test ./scripts/__tests__/rename-cargo-channel-app.test.mjs
	node --test ./scripts/__tests__/asset-copy.test.mjs
	node --test ./scripts/__tests__/install-extensions.test.mjs
	node --test ./scripts/__tests__/download-bin.test.mjs
	node --test ./scripts/__tests__/web-research-runtime.test.mjs
	node --test ./scripts/__tests__/macos-architecture-policy.test.mjs
	node --test ./scripts/__tests__/rust-workspace-lock.test.mjs
	node --test ./scripts/__tests__/release-version-stamp.test.mjs
	node --test ./scripts/__tests__/verify-macos-candidate.test.mjs
	node --test ./scripts/ci/__tests__/release-policy.test.mjs
	yarn copy:assets:tauri
	yarn build:icon
	bash ./scripts/prepare-tauri-test-resources.sh
	node ./scripts/build-cli.mjs --release --cli-only
	cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri -- --test-threads=1
	cargo test --locked --manifest-path src-tauri/plugins/tauri-plugin-hardware/Cargo.toml
	cargo test --locked --manifest-path src-tauri/plugins/tauri-plugin-document-parser/Cargo.toml
	cargo test --locked --manifest-path src-tauri/utils/Cargo.toml

# Build Biyan CLI (release, platform-aware) → src-tauri/resources/bin/biyan-cli[.exe]
build-cli:
ifeq ($(DETECTED_OS),Darwin)
	cd src-tauri && cargo build --release --features cli --bin biyan-cli --target aarch64-apple-darwin
	cd src-tauri && cargo build --release --features cli --bin biyan-cli --target x86_64-apple-darwin
	$(call MKDIR,'src-tauri/resources/bin')
	lipo -create \
		src-tauri/target/aarch64-apple-darwin/release/biyan-cli \
		src-tauri/target/x86_64-apple-darwin/release/biyan-cli \
		-output src-tauri/resources/bin/biyan-cli
	$(call MKDIR,'src-tauri/target/universal-apple-darwin/release')
	cd src-tauri && cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner --target aarch64-apple-darwin
	cd src-tauri && cargo build --release --features computer-agent-runner --bin biyan-computer-agent-runner --target x86_64-apple-darwin
	lipo -create \
		src-tauri/target/aarch64-apple-darwin/release/biyan-computer-agent-runner \
		src-tauri/target/x86_64-apple-darwin/release/biyan-computer-agent-runner \
		-output src-tauri/target/universal-apple-darwin/release/biyan-computer-agent-runner
	chmod +x src-tauri/resources/bin/biyan-cli
	chmod +x src-tauri/target/universal-apple-darwin/release/biyan-computer-agent-runner

	echo "Checking for code signing identity..."; \
	SIGNING_IDENTITY="$${APPLE_SIGNING_IDENTITY:-$(MACOS_SIGNING_IDENTITY)}"; \
	if security find-identity -v -p codesigning | grep -F "\"$$SIGNING_IDENTITY\"" >/dev/null; then \
		echo "Signing biyan-cli with identity: $$SIGNING_IDENTITY"; \
		codesign --force --options runtime --timestamp --sign "$$SIGNING_IDENTITY" src-tauri/resources/bin/biyan-cli; \
		echo "Code signing completed successfully"; \
	else \
		echo "Warning: Developer ID identity not found: $$SIGNING_IDENTITY. Skipping code signing (notarization will fail)."; \
	fi

	cp src-tauri/resources/bin/biyan-cli src-tauri/target/universal-apple-darwin/release/biyan-cli
else ifeq ($(DETECTED_OS),Windows)
	cd src-tauri && cargo build --release --features cli --bin biyan-cli
	$(call MKDIR,src-tauri\resources\bin)
	copy /Y src-tauri\target\release\biyan-cli.exe src-tauri\resources\bin\biyan-cli.exe
else
	cd src-tauri && cargo build --release --features cli --bin biyan-cli
	cp src-tauri/target/release/biyan-cli src-tauri/resources/bin/biyan-cli
endif

# Debug build for local dev (faster, native arch only)
build-cli-dev:
	$(call MKDIR,src-tauri\resources\bin)
	cd src-tauri && cargo build --features cli --bin biyan-cli
ifeq ($(DETECTED_OS),Windows)
	copy /Y src-tauri\target\debug\biyan-cli.exe src-tauri\resources\bin\biyan-cli.exe
else
	install -m755 src-tauri/target/debug/biyan-cli src-tauri/resources/bin/biyan-cli
endif

# Build
build: install-and-build install-rust-targets
	yarn build

verify-macos-candidate:
ifeq ($(DETECTED_OS),Darwin)
	@test -n "$(APP)" || (echo "APP=<path-to-Biyan.app> is required" >&2 && exit 1)
	@test -n "$(DMG)" || (echo "DMG=<path-to-Biyan_VERSION_universal.dmg> is required" >&2 && exit 1)
	@test -n "$(VERSION)" || (echo "VERSION=<semver> is required" >&2 && exit 1)
	yarn verify:macos-candidate --app "$(APP)" --dmg "$(DMG)" --version "$(VERSION)"
else
	@echo "macOS candidate verification requires a macOS host" >&2
	@exit 1
endif

clean:
	git clean -fdx -- ":(glob)**/node_modules/**" ":(glob)**/.next/**" ":(glob)**/dist/**" ":(glob)**/build/**" ":(glob)**/out/**" ":(glob)**/.turbo/**" ":(glob)**/.yarn/**" ":(glob)**/package-lock.json" ":(glob)**/tsconfig.tsbuildinfo"
ifeq ($(DETECTED_OS),Windows)
	-powershell -Command "Remove-Item -Recurse -Force ./pre-install/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./extensions/*/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./electron/pre-install/*.tgz"
	-git clean -fdX -- src-tauri/resources
	-powershell -Command "Remove-Item -Recurse -Force ./src-tauri/target"
else ifeq ($(DETECTED_OS),Linux)
	rm -rf ./pre-install/*.tgz
	rm -rf ./extensions/*/*.tgz
	rm -rf ./electron/pre-install/*.tgz
	git clean -fdX -- src-tauri/resources
	rm -rf ./src-tauri/target
	rm -rf "./.cache"
else
	rm -rfv ./pre-install/*.tgz
	rm -rfv ./extensions/*/*.tgz
	rm -rfv ./electron/pre-install/*.tgz
	git clean -fdX -- src-tauri/resources
	rm -rfv ./src-tauri/target
endif

UUID = desk-widgets@nisarg-gandhi.github.io
DEST ?= $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
APPS ?= $(HOME)/.local/share/applications
LAUNCHER = $(APPS)/desk-widgets-habits.desktop
FILES = metadata.json extension.js prefs.js stylesheet.css lib data schemas app

.PHONY: test schemas install uninstall nested shelltest

test:
	gjs -m tests/run.js

schemas:
	glib-compile-schemas schemas/

install: schemas
	rm -rf "$(DEST)"
	mkdir -p "$(DEST)"
	for f in $(FILES); do [ -e $$f ] && cp -r $$f "$(DEST)/"; done; true
	[ -n "$(SELFTEST)" ] || rm -f "$(DEST)/lib/selftest.js"   # test scaffolding is not shipped
	mkdir -p "$(APPS)"
	printf '%s\n' '[Desktop Entry]' 'Type=Application' 'Name=Habit Tracker' \
		'Comment=Daily, weekly and all-time habit logs' \
		'Exec=gjs -m "$(DEST)/app/habits.js"' 'Icon=x-office-calendar' \
		'StartupWMClass=io.github.nisarg_gandhi.DeskWidgetsHabits' 'Categories=Utility;' 'Terminal=false' > "$(LAUNCHER)"

uninstall:
	rm -f "$(LAUNCHER)"
	rm -rf "$(DEST)"

# A visible test window running a separate shell (does not use your real settings).
nested:
	tests/shell/run.sh --devkit

# Headless, scripted checks. Usage: make shelltest S=layout
shelltest:
	tests/shell/run.sh $(S)

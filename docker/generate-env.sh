#!/bin/sh

# Path where the static React files are located in the container
OUTPUT_FILE="/app/build/env-config.js"

# Generate the JS file
echo "window._env_ = {" > $OUTPUT_FILE
echo "  REACT_APP_DB_HOST: \"$REACT_APP_DB_HOST\"," >> $OUTPUT_FILE
echo "  REACT_APP_FILE_EXT: \"$REACT_APP_FILE_EXT\"," >> $OUTPUT_FILE
echo "  REACT_APP_TOOL_PREFIX: \"$REACT_APP_TOOL_PREFIX\"," >> $OUTPUT_FILE
echo "  REACT_APP_LLM_PREFIX: \"$REACT_APP_LLM_PREFIX\"," >> $OUTPUT_FILE
echo "  REACT_APP_MAX_FILES: \"$REACT_APP_MAX_FILES\"," >> $OUTPUT_FILE
echo "  REACT_APP_MAX_TOTAL_SIZE_MB: \"$REACT_APP_MAX_TOTAL_SIZE_MB\"," >> $OUTPUT_FILE
# Dev Space: "devspace" turns on the red skin + DEV SPACE logo. Unset (the
# default) leaves the build looking exactly like IntraMind, so the same image
# serves both and the voice feature can be handed over without the skin.
echo "  REACT_APP_BRAND: \"$REACT_APP_BRAND\"," >> $OUTPUT_FILE
# Mirrors the gateway's DEV_READONLY_CORPUS. This one only hides controls;
# the gateway guard is what actually protects the corpus.
echo "  REACT_APP_READONLY_CORPUS: \"$REACT_APP_READONLY_CORPUS\"" >> $OUTPUT_FILE
echo "};" >> $OUTPUT_FILE

echo "Configuration injected into $OUTPUT_FILE"

# Execute the passed command (starts the server)
exec "$@"
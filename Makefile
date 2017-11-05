FFFILES  = manifest.json
FFFILES += icon.png
FFFILES += background.js

firefox/https-by-default.xpi: $(addprefix firefox/,$(FFFILES))
	cd firefox && zip https-by-default.xpi $(FFFILES)

clean:
	rm -f firefox/https-by-default.xpi

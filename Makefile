FFFILES  = install.rdf
FFFILES += icon.png
FFFILES += components/urifixup.js

firefox/https-by-default.xpi: $(addprefix firefox/,$(FFFILES))
	cd firefox && zip https-by-default.xpi $(FFFILES)

clean:
	rm -f firefox/https-by-default.xpi

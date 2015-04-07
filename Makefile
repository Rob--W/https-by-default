FFFILES  = install.rdf
FFFILES += bootstrap.js
FFFILES += icon.png

firefox/https-by-default.xpi: $(addprefix firefox/,$(FFFILES))
	cd firefox && zip https-by-default.xpi $(FFFILES)

clean:
	rm -f firefox/https-by-default.xpi

const sleepTimeout = process.env.SLEEP_TIMEOUT || 5000;

const parseSparqlResults = (data) => {
  const vars = data.head.vars;
  return data.results.bindings.map(binding => {
    let obj = {};
    vars.forEach(varKey => {
      if (binding[varKey]) {
        obj[varKey] = binding[varKey].value;
      }
    });
    return obj;
  })
};

function sleep() {
  return new Promise((resolve) => {
    setTimeout(resolve, sleepTimeout);
  });
}

export {
  parseSparqlResults,
  sleep,
};

const load = async (container, { id, position = null, hp = null }) => {
  if (id === null) return;

  const response = await fetch(`/cards/${id}`);
  const data = await response.json();

  // name
  container.querySelector(".card-name").innerText = data.name;
  // artwork
  container.querySelector(".card-artwork").style.backgroundImage = `url("${data.artworkPath}")`;
  // traits
  // affiliations
  // abilities
  // shinsu
  // positions
  // hp
};

export default load;

/** @format */

(() => {
	const bindBack = () => {
		document.getElementById('back-btn')?.addEventListener('click', () => {
			if (window.history.length > 1) window.history.back();
			else window.location.href = 'browse-surveys.html';
		});
	};

	const bindAnchors = () => {
		document.querySelectorAll('.cgu-toc a[href^="#"]').forEach((anchor) => {
			anchor.addEventListener('click', (event) => {
				const targetId = anchor.getAttribute('href');
				if (!targetId || targetId === '#') return;
				const target = document.querySelector(targetId);
				if (!target) return;
				event.preventDefault();
				const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - 96);
				window.scrollTo({ top, behavior: 'smooth' });
			});
		});
	};

	const observeSections = () => {
		const links = [...document.querySelectorAll('.cgu-toc a')];
		const sections = [...document.querySelectorAll('.cgu-article[id]')];
		if (!links.length || !sections.length) return;

		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (!entry.isIntersecting) return;
					const id = `#${entry.target.id}`;
					links.forEach((link) => {
						link.classList.toggle('active', link.getAttribute('href') === id);
					});
				});
			},
			{
				root: null,
				threshold: 0.25,
				rootMargin: '-12% 0px -60% 0px',
			},
		);

		sections.forEach((section) => observer.observe(section));
	};

	const init = () => {
		bindBack();
		bindAnchors();
		observeSections();
	};

	document.addEventListener('DOMContentLoaded', init);
})();
